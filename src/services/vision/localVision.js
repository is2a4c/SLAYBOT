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

function jobTimeoutMs() {
  const parsed = Number.parseInt(process.env.IMAGE_SPAM_VISION_TIMEOUT_MS, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : JOB_TIMEOUT_MS;
}
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

  const current = new Worker(WORKER_PATH, {
    workerData: {
      modelId: modelId(),
      dtype: process.env.IMAGE_SPAM_VISION_DTYPE || "q4",
      threads: process.env.IMAGE_SPAM_ONNX_THREADS,
      cacheDir: process.env.IMAGE_SPAM_MODEL_CACHE,
    },
  });
  worker = current;

  current.on("message", ({ id, text, error }) => {
    const job = pending.get(id);
    if (!job || job.worker !== current) return;
    settle(id, (entry) => (error ? entry.reject(new Error(error)) : entry.resolve(text)));
  });

  // Only this worker's jobs may be rejected here: `pending` is shared, and a
  // discarded worker's late exit must not cancel its successor's job.
  const fail = (reason) => {
    if (worker === current) worker = null;
    for (const [id, job] of [...pending.entries()]) {
      if (job.worker === current) settle(id, (entry) => entry.reject(new Error(reason)));
    }
  };

  current.on("error", (error) => fail(`local vision worker failed: ${error.message}`));
  current.on("exit", (code) => {
    if (worker === current) worker = null;
    if (code !== 0) fail(`local vision worker exited with code ${code}`);
  });

  // The worker must not hold the process open on shutdown.
  current.unref();
  return current;
}

/**
 * @param {Worker} [owner] the worker to drop, current by default
 * @returns {Promise<void>}
 */
function discardWorker(owner = worker) {
  if (worker === owner) worker = null;
  if (!owner) return Promise.resolve();
  return owner.terminate().catch(() => {});
}

function send(job) {
  const id = nextJobId;
  nextJobId += 1;
  const timeoutMs = job.type === "preload" ? PRELOAD_TIMEOUT_MS : jobTimeoutMs();

  return new Promise((resolve, reject) => {
    let current;
    try {
      current = getWorker();
    } catch (error) {
      reject(error);
      return;
    }

    const timer = setTimeout(() => {
      settle(id, (entry) => entry.reject(new Error(`local vision timed out after ${timeoutMs} ms`)));
      // A generation that outlived its job still owns the thread. Dropping only
      // that worker lets the next job start a fresh one.
      discardWorker(current);
    }, timeoutMs);
    timer.unref?.();

    pending.set(id, { resolve, reject, timer, worker: current });

    try {
      current.postMessage({ ...job, id });
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
    await discardWorker(worker);
  },
};
