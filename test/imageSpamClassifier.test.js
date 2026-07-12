const test = require("node:test");
const assert = require("node:assert/strict");

require("module-alias/register");
const { scoreImageSpam, isImageAttachment, analyzeWithVision } = require("../src/services/imageSpamClassifier");
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
  assert.ok(result.reasons.some((reason) => reason.includes("bait caption")));
});

test("low-confidence OCR alone cannot cross the default threshold", () => {
  const result = scoreImageSpam({
    ocrText: "$9000 withdrawal successful crypto wallet claim reward",
    confidence: 12,
    visual: { width: 1000, height: 600, entropy: 6 },
  });

  assert.equal(result.score, 69);
});

test("recognizes image MIME types and common image extensions", () => {
  assert.equal(isImageAttachment({ contentType: "image/jpeg", name: "upload" }), true);
  assert.equal(isImageAttachment({ contentType: null, name: "photo.WEBP" }), true);
  assert.equal(isImageAttachment({ contentType: "application/pdf", name: "invoice.pdf" }), false);
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
