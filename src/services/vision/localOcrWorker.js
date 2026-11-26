const { parentPort, workerData } = require("worker_threads");

/**
 * Tesseract, kept out of the bot's thread.
 *
 * tesseract.js reports some initialisation failures twice — a reject followed
 * by a resolve for the same job — and the resolve then throws inside the
 * Worker message listener. An uncaught exception in a worker thread only ends
 * that thread; the bot receives it as an error and falls back to "no text",
 * which a shared thread or the main process could not do.
 */

let runtimePromise;

async function getRuntime() {
  if (!runtimePromise) {
    runtimePromise = (async () => {
      const sharp = require("sharp");
      const { createWorker } = require("tesseract.js");
      const reader = await createWorker(workerData.languages, 1, {
        cachePath: workerData.cachePath,
        logger: () => {},
        // Without a handler tesseract.js throws inside its message listener
        // even for an ordinary recognition error.
        errorHandler: () => {},
      });
      return { sharp, reader };
    })().catch((error) => {
      runtimePromise = undefined;
      throw error;
    });
  }

  return runtimePromise;
}

async function prepareForReading(sharp, buffer) {
  try {
    // Tesseract ignores a short line floating on a large empty canvas — which
    // is exactly how a contact handle sits in a collage panel. Cutting the
    // margins, then upscaling, keeps that line in the result.
    return {
      buffer: await sharp(buffer, { limitInputPixels: 30_000_000 })
        .trim({ threshold: 25 })
        .resize({ width: 1800, withoutEnlargement: false })
        .png()
        .toBuffer(),
      changed: true,
    };
  } catch {
    // A uniform image has nothing to trim; Tesseract reads the original.
    return { buffer, changed: false };
  }
}

function parse(data) {
  const text = String(data?.text || "")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
  const reported = Number(data?.confidence);
  return {
    text,
    // Reading a reasonable amount of text is itself evidence the model
    // succeeded; a missing score must not silence the heuristics downstream.
    confidence: text ? Math.min(100, Math.max(0, Number.isFinite(reported) ? reported : 80)) : 0,
  };
}

async function recognize(buffer) {
  const { sharp, reader } = await getRuntime();
  const prepared = await prepareForReading(sharp, buffer);
  const result = parse((await reader.recognize(prepared.buffer)).data);
  // Trimming is what makes a lone contact handle readable, but a busy photo
  // can trim down to nothing. An empty read is retried on the whole frame.
  if (result.text || !prepared.changed) return result;
  return parse((await reader.recognize(buffer)).data);
}

parentPort.on("message", async (job) => {
  try {
    if (job?.type === "preload") {
      await getRuntime();
      parentPort.postMessage({ id: job.id, text: workerData.languages.join("+") });
      return;
    }
    parentPort.postMessage({ id: job.id, ...(await recognize(job.buffer)) });
  } catch (error) {
    parentPort.postMessage({ id: job.id, error: error.message });
  }
});
