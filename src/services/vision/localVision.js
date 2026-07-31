const path = require("path");
const { Worker } = require("worker_threads");

/**
 * Client for the vision worker: one thread, one job at a time, restarted if it
 * dies. Everything heavy happens over there, so an image never costs the bot
 * its responsiveness.
 */

const WORKER_PATH = path.join(__dirname, "localVisionWorker.js");
const DEFAULT_MODEL = "HuggingFaceTB/SmolVLM-500M-Instruct";
const JOB_TIMEOUT_MS = 120_000;
// The first load downloads the weights, which is minutes on a cold cache.
const PRELOAD_TIMEOUT_MS = 15 * 60_000;

let worker = null;
let nextJobId = 1;
const pending = new Map();

function modelId() {
  return process.env.IMAGE_SPAM_VISION_MODEL || DEFAULT_MODEL;
}

function settle(id, handler) {
  const job = pending.get(id);
  if (!job) return;

  clearTimeout(job.timer);
  pending.delete(id);
  handler(job);
}

/**
 * @returns {Worker}
 */
function getWorker() {
  if (worker) return worker;

  worker = new Worker(WORKER_PATH, {
    workerData: {
      modelId: modelId(),
      dtype: process.env.IMAGE_SPAM_VISION_DTYPE || "q4",
      threads: process.env.IMAGE_SPAM_ONNX_THREADS,
      cacheDir: process.env.IMAGE_SPAM_MODEL_CACHE,
    },
  });

  worker.on("message", ({ id, text, error }) => {
    settle(id, (job) => (error ? job.reject(new Error(error)) : job.resolve(text)));
  });

  const fail = (reason) => {
    worker = null;
    for (const id of [...pending.keys()]) settle(id, (job) => job.reject(new Error(reason)));
  };

  worker.on("error", (error) => fail(`local vision worker failed: ${error.message}`));
  worker.on("exit", (code) => {
    if (code !== 0) fail(`local vision worker exited with code ${code}`);
    worker = null;
  });

  // The worker must not hold the process open on shutdown.
  worker.unref();
  return worker;
}

/**
 * @param {object} job
 * @returns {Promise<string>}
 */
function send(job) {
  const id = nextJobId;
  nextJobId += 1;
  const timeoutMs = job.type === "preload" ? PRELOAD_TIMEOUT_MS : JOB_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      settle(id, (entry) => entry.reject(new Error(`local vision timed out after ${timeoutMs} ms`)));
    }, timeoutMs);
    timer.unref?.();

    pending.set(id, { resolve, reject, timer });

    try {
      getWorker().postMessage({ ...job, id });
    } catch (error) {
      settle(id, (entry) => entry.reject(error));
    }
  });
}

module.exports = {
  DEFAULT_MODEL,
  modelId,

  /**
   * @param {{buffer: Buffer, prompt: string, split: boolean}} input
   * @returns {Promise<string>}
   */
  describe: (input) => send(input),

  /**
   * Load the model ahead of the first image so moderation does not pay for it.
   *
   * @returns {Promise<string>} the model that was loaded
   */
  preload: async () => {
    await send({ type: "preload" });
    return modelId();
  },

  /**
   * @returns {Promise<void>}
   */
  stop: async () => {
    if (!worker) return;
    const current = worker;
    worker = null;
    await current.terminate().catch(() => {});
  },
};
