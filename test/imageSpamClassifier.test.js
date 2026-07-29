const test = require("node:test");
const assert = require("node:assert/strict");

require("module-alias/register");
const {
  scoreImageSpam,
  isImageAttachment,
  analyzeWithVision,
  analyzeVisionImages,
  combineImageSpamResults,
  prepareImage,
  runIoVision,
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
  assert.equal(result.regionsAnalyzed, 3);
  assert.equal(result.regionsAvailable, 3);
});

test("local vision can cap regions while keeping the highest OCR-risk tile", async () => {
  const previous = process.env.IMAGE_SPAM_VISION_MAX_REGIONS;
  process.env.IMAGE_SPAM_VISION_MAX_REGIONS = "2";
  try {
    const images = [Buffer.from("full"), Buffer.from("ordinary-tile"), Buffer.from("risky-tile")];
    const candidates = [
      { text: "ordinary screenshot", confidence: 80 },
      { text: "release notes", confidence: 80 },
      { text: "$4600 reward withdrawal", confidence: 80 },
    ];
    const seen = [];
    const result = await analyzeVisionImages(images, candidates, "bro", async (buffer) => {
      seen.push(buffer.toString());
      return buffer.toString() === "risky-tile" ? "IMAGE_SPAM" : "IMAGE_SAFE";
    });

    assert.deepEqual(seen, ["full", "risky-tile"]);
    assert.equal(result.index, 2);
    assert.equal(result.score, 85);
    assert.equal(result.regionsAnalyzed, 2);
    assert.equal(result.regionsAvailable, 3);
  } finally {
    if (previous === undefined) delete process.env.IMAGE_SPAM_VISION_MAX_REGIONS;
    else process.env.IMAGE_SPAM_VISION_MAX_REGIONS = previous;
  }
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

test("io.net vision sends multiple prepared regions in one authenticated request", async () => {
  const previousKey = process.env.IO_INTELLIGENCE_API_KEY;
  const previousModel = process.env.IMAGE_SPAM_REMOTE_MODEL;
  const previousFetch = global.fetch;
  process.env.IO_INTELLIGENCE_API_KEY = "test-secret";
  process.env.IMAGE_SPAM_REMOTE_MODEL = "meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8";
  let request;
  global.fetch = async (url, options) => {
    request = { url, options, body: JSON.parse(options.body) };
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: "IMAGE_SPAM" } }] }),
    };
  };

  try {
    const response = await runIoVision([Buffer.from("full"), Buffer.from("tile")], "bro", "$4600 reward");
    assert.equal(response, "IMAGE_SPAM");
    assert.equal(request.url, "https://api.intelligence.io.solutions/api/v1/chat/completions");
    assert.equal(request.options.headers.Authorization, "Bearer test-secret");
    assert.equal(request.body.model, "meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8");
    assert.equal(request.body.messages[0].content.filter((item) => item.type === "image_url").length, 2);
    assert.match(request.body.messages[0].content[1].image_url.url, /^data:image\/png;base64,/);
  } finally {
    global.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.IO_INTELLIGENCE_API_KEY;
    else process.env.IO_INTELLIGENCE_API_KEY = previousKey;
    if (previousModel === undefined) delete process.env.IMAGE_SPAM_REMOTE_MODEL;
    else process.env.IMAGE_SPAM_REMOTE_MODEL = previousModel;
  }
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

test("image moderation analyzes every attachment before deciding", async () => {
  const message = {
    id: "message-all-images",
    content: "",
    attachments: new Map([
      ["a", { name: "spam.png", contentType: "image/png", url: "https://cdn.test/spam.png" }],
      ["b", { name: "cat.png", contentType: "image/png", url: "https://cdn.test/cat.png" }],
      ["c", { name: "meme.png", contentType: "image/png", url: "https://cdn.test/meme.png" }],
    ]),
    client: { logger: { warn: () => assert.fail("unexpected warning") } },
  };
  const seen = [];
  const classifier = async ({ url }) => {
    seen.push(url);
    return url.endsWith("spam.png")
      ? { risky: true, score: 88, model: "test-vision", reasons: ["casino promo"], ocrText: "", confidence: 80 }
      : { risky: false, score: 5, model: "test-vision", reasons: [], ocrText: "", confidence: 80 };
  };

  const result = await inspectImageSpam(message, { image_spam_threshold: 70 }, classifier);

  assert.equal(result.shouldDelete, true);
  assert.deepEqual(seen, ["https://cdn.test/spam.png", "https://cdn.test/cat.png", "https://cdn.test/meme.png"]);
});

test("combines OCR context spread across separate images", () => {
  const combined = combineImageSpamResults(
    [
      {
        imageIndex: 0,
        risky: false,
        score: 30,
        model: "test-vision",
        reasons: ["known scam brand"],
        ocrText: "Меллстрой",
        confidence: 80,
      },
      {
        imageIndex: 1,
        risky: false,
        score: 42,
        model: "test-vision",
        reasons: ["casino promo"],
        ocrText: "открыл своё казино и раздаёт бонус каждому новому пользователю",
        confidence: 75,
      },
    ],
    { threshold: 70 }
  );

  assert.equal(combined.risky, true);
  assert.ok(combined.score >= 70);
  assert.match(combined.ocrText, /Image 1:[\s\S]*Меллстрой/);
  assert.match(combined.ocrText, /Image 2:[\s\S]*казино/);
  assert.ok(combined.reasons.some((reason) => reason.includes("combined image context")));
});

test("does not aggregate unreliable OCR from another image", () => {
  const combined = combineImageSpamResults(
    [
      {
        imageIndex: 0,
        risky: false,
        score: 10,
        model: "test-vision",
        reasons: [],
        ocrText: "Меллстрой казино раздаёт бонус каждому",
        confidence: 12,
      },
      {
        imageIndex: 1,
        risky: false,
        score: 0,
        model: "test-vision",
        reasons: [],
        ocrText: "обычная фотография",
        confidence: 90,
      },
    ],
    { threshold: 70 }
  );

  assert.equal(combined.risky, false);
  assert.doesNotMatch(combined.ocrText, /Меллстрой/);
});

test("later images receive OCR context accumulated from earlier images", async () => {
  const message = {
    id: "message-context",
    content: "смотрите",
    attachments: new Map([
      ["a", { name: "first.png", contentType: "image/png", url: "https://cdn.test/first.png" }],
      ["b", { name: "second.png", contentType: "image/png", url: "https://cdn.test/second.png" }],
    ]),
    client: { logger: { warn: () => assert.fail("unexpected warning") } },
  };
  const captions = [];
  const classifier = async ({ url, caption }) => {
    captions.push(caption);
    return {
      risky: false,
      score: 10,
      model: "test-vision",
      reasons: [],
      ocrText: url.endsWith("first.png") ? "Меллстрой" : "обычная картинка",
      confidence: 80,
    };
  };

  await inspectImageSpam(message, { image_spam_threshold: 70 }, classifier);

  assert.equal(captions[0], "смотрите");
  assert.match(captions[1], /Text recognized in previous images:[\s\S]*Меллстрой/);
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
  assert.match(warning, /skipped attachment 1\/1/);
});
