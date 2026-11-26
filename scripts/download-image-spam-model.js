require("module-alias/register");

const { preloadVisionModel } = require("@src/services/imageSpamClassifier");
const { resolveProvider } = require("@src/services/ai/visionProvider");
const localOcr = require("@src/services/vision/localOcr");

function readPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const attempts = readPositiveInteger(process.env.IMAGE_SPAM_MODEL_DOWNLOAD_ATTEMPTS, 3);
const retryDelayMs = readPositiveInteger(process.env.IMAGE_SPAM_MODEL_DOWNLOAD_RETRY_DELAY_MS, 5_000);

function isTransientDownloadError(error) {
  return /fetch failed|network|timed? ?out|econnreset|econnrefused|eai_again|http 5\d\d/i.test(error.message);
}

async function preloadWithRetries(loadModel = preloadVisionModel, options = {}) {
  const maxAttempts = readPositiveInteger(options.attempts, attempts);
  const delayMs = readPositiveInteger(options.retryDelayMs, retryDelayMs);
  const sleep = options.sleep || ((duration) => new Promise((resolve) => setTimeout(resolve, duration)));

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await loadModel();
    } catch (error) {
      if (attempt === maxAttempts || !isTransientDownloadError(error)) throw error;
      console.warn(`Image-spam model download attempt ${attempt}/${maxAttempts} failed: ${error.message}`);
      await sleep(delayMs * attempt);
    }
  }
}

async function main() {
  try {
    const model = await preloadWithRetries();
    console.log(`Image-spam model ready: ${model}`);

    // The free path also reads text locally; fetching its language data now
    // keeps the first spam image from waiting for the download.
    if (!resolveProvider().configured) {
      try {
        console.log(`Image-spam OCR ready: ${await localOcr.prepare()}`);
      } catch (error) {
        console.warn(`Image-spam OCR is not preloaded (it will still try at runtime): ${error.message}`);
      }
    }
  } catch (error) {
    console.error(`Failed to prepare image-spam model after ${attempts} attempts: ${error.message}`);
    process.exitCode = 1;
  }
}

if (require.main === module) void main();

module.exports = { isTransientDownloadError, preloadWithRetries, readPositiveInteger };
