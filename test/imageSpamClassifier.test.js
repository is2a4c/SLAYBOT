const test = require("node:test");
const assert = require("node:assert/strict");

require("module-alias/register");
const {
  scoreImageSpam,
  isImageAttachment,
  analyzeWithVision,
  analyzeVisionImages,
  prepareImage,
  selectVisionCandidate,
} = require("../src/services/imageSpamClassifier");
const { inspectImageSpam } = require("../src/handlers/automod");

test("scores a fake withdrawal collage above the safe threshold", () => {
  const result = scoreImageSpam({
    caption: "bro",
    ocrText: "$4600.00 Reward Received\nWithdrawal successful\nClaim your crypto payment\nWallet balance",
    confidence: 82,
    visual: { width: 900, height: 600, entropy: 6.2 },
  });

  assert.ok(result.score >= 70);
  assert.ok(result.reasons.some((reason) => reason.includes("money amount")));
  assert.ok(result.reasons.some((reason) => reason.includes("collage")));
});

test("does not flag an ordinary text-heavy screenshot", () => {
  const result = scoreImageSpam({
    caption: "release notes",
    ocrText: "Version 2.1\nFixed login issue\nImproved performance\nThank you for testing",
    confidence: 91,
    visual: { width: 1000, height: 700, entropy: 6 },
  });

  assert.equal(result.score, 0);
});

test("flags a large payout panel with a bait caption even when tiny OCR misses other words", () => {
  const result = scoreImageSpam({
    caption: "bro",
    ocrText: "$4600.00\naccount overview\ntransaction details\nrecent activity",
    confidence: 40,
    visual: { width: 650, height: 442, entropy: 6 },
  });

  assert.equal(result.score, 70);
  assert.ok(result.reasons.some((reason) => reason.includes("conversational bait")));
});

test("detects conversational bait rendered inside a payout screenshot", () => {
  const result = scoreImageSpam({
    ocrText: "bro\n$7200.00\naccount overview\ntransaction details\nrecent activity",
    confidence: 40,
    visual: { width: 650, height: 442, entropy: 6 },
  });

  assert.equal(result.score, 70);
});

test("low-confidence OCR alone cannot cross the default threshold", () => {
  const result = scoreImageSpam({
    ocrText: "$9000 withdrawal successful crypto wallet claim reward",
    confidence: 12,
    visual: { width: 1000, height: 600, entropy: 6 },
  });

  assert.equal(result.score, 69);
});

test("low-confidence OCR with a bait caption still cannot delete a message", () => {
  const result = scoreImageSpam({
    caption: "bro",
    ocrText: "$9000 withdrawal successful crypto wallet claim reward",
    confidence: 12,
    visual: { width: 1000, height: 600, entropy: 6 },
  });

  assert.equal(result.score, 69);
});

test("recognizes cryptocurrency wallet addresses as a strong signal", () => {
  const result = scoreImageSpam({
    ocrText: "claim reward 0x0123456789abcdef0123456789abcdef01234567",
    confidence: 80,
    visual: { width: 800, height: 800, entropy: 5 },
  });

  assert.ok(result.reasons.some((reason) => reason.includes("wallet address")));
});

test("flags a Russian casino-referral scam collage", () => {
  const result = scoreImageSpam({
    ocrText:
      "Меллстрой открыл своё казино и раздаёт 10000 рублей каждому новому пользователю. " +
      "Бонус можно получить на mellget.com. После регистрации деньги поступают на баланс.",
    confidence: 60,
    visual: { width: 1200, height: 800, entropy: 6 },
  });

  assert.ok(result.score >= 70, `expected >= 70, got ${result.score}`);
  assert.ok(result.reasons.some((reason) => reason.includes("gambling/casino")));
  assert.ok(result.reasons.some((reason) => reason.includes("scam brand")));
});

test("flags a fake Russian bank-transfer proof paired with a casino promo", () => {
  const result = scoreImageSpam({
    ocrText: "Ozon банк\nПереводы +10 823 ₽\nБаланс 10 822 руб\nказино бонус mellget.com",
    confidence: 55,
    visual: { width: 1400, height: 900, entropy: 6 },
  });

  assert.ok(result.score >= 70, `expected >= 70, got ${result.score}`);
});

test("does not flag a plain Russian bank balance screenshot", () => {
  const result = scoreImageSpam({
    ocrText: "Баланс\nОсновной счёт\nРоссийский рубль\n10 822 рубля\nПополнить\nПодробнее",
    confidence: 85,
    visual: { width: 800, height: 1000, entropy: 5 },
  });

  assert.ok(result.score < 50, `expected < 50, got ${result.score}`);
});

test("selects the image region with the strongest OCR risk for vision", () => {
  const visionImages = [Buffer.from("full"), Buffer.from("safe"), Buffer.from("payout")];
  const selected = selectVisionCandidate(
    {
      candidates: [
        { text: "release notes", confidence: 90 },
        { text: "ordinary screenshot", confidence: 85 },
        { text: "$4600 reward withdrawal successful", confidence: 72 },
      ],
    },
    visionImages,
    "bro",
    { width: 900, height: 600, entropy: 6 }
  );

  assert.equal(selected.index, 2);
  assert.equal(selected.buffer.toString(), "payout");
  assert.match(selected.ocrHint, /4600/);
  assert.equal(selected.confidence, 72);
});

test("recognizes image MIME types and common image extensions", () => {
  assert.equal(isImageAttachment({ contentType: "image/jpeg", name: "upload" }), true);
  assert.equal(isImageAttachment({ contentType: null, name: "photo.WEBP" }), true);
  assert.equal(isImageAttachment({ contentType: "application/pdf", name: "invoice.pdf" }), false);
});

test("prepares the full image and four overlapping collage regions", async () => {
  const image = await require("sharp")({
    create: { width: 64, height: 64, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();

  const prepared = await prepareImage(image);

  assert.equal(prepared.ocrImages.length, 5);
  assert.equal(prepared.visionImages.length, 5);
});

test("local vision analyzes every prepared collage region", async () => {
  const images = [Buffer.from("full"), Buffer.from("top-left"), Buffer.from("bottom-right")];
  const candidates = [
    { text: "ordinary screenshot", confidence: 80 },
    { text: "release notes", confidence: 80 },
    { text: "$4600 reward withdrawal", confidence: 80 },
  ];
  const seen = [];
  const result = await analyzeVisionImages(images, candidates, "bro", async (buffer, caption, hint, split) => {
    seen.push({ image: buffer.toString(), caption, hint, split });
    return buffer.toString() === "bottom-right" ? "IMAGE_SPAM" : "IMAGE_SAFE";
  });

  assert.deepEqual(
    seen.map(({ image }) => image),
    ["full", "top-left", "bottom-right"]
  );
  assert.equal(seen[1].split, false);
  assert.match(seen[2].hint, /4600/);
  assert.equal(result.index, 2);
  assert.equal(result.score, 85);
});

test("local vision adapter parses the model response", async () => {
  const result = await analyzeWithVision(Buffer.from("image"), "bro", async () => {
    return "Assistant: IMAGE_SPAM";
  });

  assert.equal(result.score, 85);
  assert.deepEqual(result.reasons, ["local vision detected financial reward spam"]);
  assert.equal(result.detectedText, "");
  assert.match(result.model, /SmolVLM/);
});

test("local vision adapter uses the final label after the echoed prompt", async () => {
  const result = await analyzeWithVision(Buffer.from("image"), "release notes", async () => {
    return "Reply with IMAGE_SPAM or IMAGE_SAFE. Assistant: IMAGE_SAFE";
  });

  assert.equal(result.score, 10);
});

test("image moderation returns deletion fields for a risky classifier result", async () => {
  const message = {
    id: "message-1",
    content: "bro",
    attachments: new Map([
      ["image", { name: "spam.jpg", contentType: "image/jpeg", url: "https://cdn.test/spam.jpg" }],
    ]),
    client: { logger: { warn: () => assert.fail("unexpected warning") } },
  };
  const classifier = async () => ({
    risky: true,
    score: 91,
    model: "test-vision",
    reasons: ["fake payout"],
    ocrText: "$4600 withdrawal successful",
    confidence: 80,
  });

  const result = await inspectImageSpam(message, { image_spam_threshold: 70 }, classifier);
  assert.equal(result.shouldDelete, true);
  assert.equal(result.strikes, 1);
  assert.match(result.fields[0].name, /91\/100/);
  assert.match(result.fields[0].value, /fake payout/);
});

test("image moderation flags a spammy attachment that is not the first image", async () => {
  const message = {
    id: "message-multi",
    content: "",
    attachments: new Map([
      ["a", { name: "cat.png", contentType: "image/png", url: "https://cdn.test/cat.png" }],
      ["b", { name: "scam.png", contentType: "image/png", url: "https://cdn.test/scam.png" }],
    ]),
    client: { logger: { warn: () => assert.fail("unexpected warning") } },
  };
  const seen = [];
  const classifier = async ({ url }) => {
    seen.push(url);
    return url.endsWith("scam.png")
      ? { risky: true, score: 88, model: "test-vision", reasons: ["fake payout"], ocrText: "", confidence: 70 }
      : { risky: false, score: 5, model: "test-vision", reasons: [], ocrText: "", confidence: 70 };
  };

  const result = await inspectImageSpam(message, { image_spam_threshold: 70 }, classifier);
  assert.equal(result.shouldDelete, true);
  assert.equal(result.strikes, 1);
  assert.deepEqual(seen, ["https://cdn.test/cat.png", "https://cdn.test/scam.png"]);
  assert.match(result.fields[0].name, /image 2\/2/);
});

test("image moderation fails open when the vision service errors", async () => {
  let warning = "";
  const message = {
    id: "message-2",
    content: "bro",
    attachments: new Map([
      ["image", { name: "spam.jpg", contentType: "image/jpeg", url: "https://cdn.test/spam.jpg" }],
    ]),
    client: { logger: { warn: (text) => (warning = text) } },
  };

  const result = await inspectImageSpam(message, { image_spam_threshold: 70 }, async () => {
    throw new Error("service unavailable");
  });

  assert.equal(result.shouldDelete, false);
  assert.equal(result.strikes, 0);
  assert.match(warning, /left untouched/);
});
