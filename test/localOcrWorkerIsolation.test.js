const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

require("module-alias/register");
const localOcr = require("../src/services/vision/localOcr");

test("a broken traineddata file kills only the OCR worker, not the process", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "slaybot-ocr-"));
  const data = Buffer.alloc(300000);
  data.writeInt32LE(24, 0);
  const target = path.join(directory, "rus.traineddata");
  fs.writeFileSync(target, data);
  // A valid checksum means the cache is trusted and no download is attempted;
  // Tesseract then fails to initialise on the file itself. That failure used
  // to escape the worker listener as an uncaught exception.
  fs.writeFileSync(
    `${target}.json`,
    JSON.stringify({ size: data.length, sha256: crypto.createHash("sha256").update(data).digest("hex") })
  );

  const previousCache = process.env.IMAGE_SPAM_OCR_CACHE;
  const previousLangs = process.env.IMAGE_SPAM_OCR_LANGS;
  const previousTimeout = process.env.IMAGE_SPAM_LOCAL_OCR_TIMEOUT_MS;
  process.env.IMAGE_SPAM_OCR_CACHE = directory;
  process.env.IMAGE_SPAM_OCR_LANGS = "rus";
  process.env.IMAGE_SPAM_LOCAL_OCR_TIMEOUT_MS = "5000";

  try {
    const result = await localOcr.recognize(Buffer.from("not an image"));

    assert.deepEqual(result, { text: "", confidence: 0 }, "a broken model reads as nothing, not as a crash");
    assert.ok(localOcr.status().lastError, "the failure is reported for diagnostics");
  } finally {
    await localOcr.stop();
    fs.rmSync(directory, { recursive: true, force: true });
    for (const [name, value] of [
      ["IMAGE_SPAM_OCR_CACHE", previousCache],
      ["IMAGE_SPAM_OCR_LANGS", previousLangs],
      ["IMAGE_SPAM_LOCAL_OCR_TIMEOUT_MS", previousTimeout],
    ]) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
