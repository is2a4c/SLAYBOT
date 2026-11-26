const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { Worker } = require("worker_threads");

/**
 * Free OCR for the image-spam check, used whenever no remote vision provider is
 * configured or the configured one is failing.
 *
 * Without it the free path only had a 500M vision model guessing from pixels;
 * the spam heuristics never saw the text the image actually contains. Tesseract
 * reads Russian and English on this host, so a message is still checked without
 * any API key and without paying per image. It runs in its own thread, the same
 * way the local vision model does, because tesseract.js can throw from inside
 * its own worker listener where no promise can catch it.
 */

const WORKER_PATH = path.join(__dirname, "localOcrWorker.js");
const DEFAULT_LANGS = "rus+eng";
const START_TIMEOUT_MS = 120_000;
const RECOGNIZE_TIMEOUT_MS = 30_000;
const FAILURES_BEFORE_PAUSE = 3;
const PAUSE_MS = 10 * 60_000;
// Same data tesseract.js fetches by default, but validated into the shared
// cache before a worker starts: damaged data fails tesseract's initialisation
// in a way that cannot be turned into an error response.
const DATA_BASE_URL = "https://cdn.jsdelivr.net/npm/@tesseract.js-data";
const EMPTY = { text: "", confidence: 0 };

let worker = null;
let prepared = null;
let nextJobId = 1;
const pending = new Map();
let queue = Promise.resolve();
let failures = 0;
let pausedUntil = 0;
let lastError = "";

function enabled() {
  return process.env.IMAGE_SPAM_LOCAL_OCR !== "false";
}

function languages() {
  const parsed = String(process.env.IMAGE_SPAM_OCR_LANGS || DEFAULT_LANGS)
    .split("+")
    .map((lang) => lang.trim())
    .filter(Boolean);
  return parsed.length ? parsed : DEFAULT_LANGS.split("+");
}

function cachePath() {
  return process.env.IMAGE_SPAM_OCR_CACHE || path.join(process.cwd(), ".cache", "tesseract");
}

function timeoutFromEnv(name, fallback) {
  const parsed = Number.parseInt(process.env[name], 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function trainedDataPath(lang) {
  return path.join(cachePath(), `${lang}.traineddata`);
}

function trainedDataMetaPath(lang) {
  return `${trainedDataPath(lang)}.json`;
}

function digest(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

// Only data this module wrote and verified is used. A damaged file makes
// Tesseract fail during initialisation, which would otherwise be retried on
// every image and repeated download attempts.
function cachedLanguageValid(lang) {
  try {
    const meta = JSON.parse(fs.readFileSync(trainedDataMetaPath(lang), "utf8"));
    const data = fs.readFileSync(trainedDataPath(lang));
    return meta.size === data.length && meta.sha256 === digest(data);
  } catch {
    return false;
  }
}

async function downloadLanguage(lang) {
  const timeoutMs = timeoutFromEnv("IMAGE_SPAM_LOCAL_OCR_START_TIMEOUT_MS", START_TIMEOUT_MS);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    const response = await fetch(`${DATA_BASE_URL}/${lang}/4.0.0_best_int/${lang}.traineddata.gz`, {
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`OCR language ${lang} download returned HTTP ${response.status}`);

    const data = zlib.gunzipSync(Buffer.from(await response.arrayBuffer()));
    const target = trainedDataPath(lang);
    const temporary = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, data);
    fs.renameSync(temporary, target);
    fs.writeFileSync(trainedDataMetaPath(lang), JSON.stringify({ size: data.length, sha256: digest(data) }));
  } finally {
    clearTimeout(timer);
  }
}

async function invalidateCache() {
  prepared = null;
  for (const lang of languages()) {
    await fs.promises.rm(trainedDataPath(lang), { force: true }).catch(() => {});
    await fs.promises.rm(trainedDataMetaPath(lang), { force: true }).catch(() => {});
  }
}

/**
 * Fetch the language data into the shared cache without starting a worker.
 *
 * @returns {Promise<string>} the configured language list
 */
async function prepare() {
  fs.mkdirSync(cachePath(), { recursive: true });
  for (const lang of languages()) {
    if (!cachedLanguageValid(lang)) await downloadLanguage(lang);
  }
  return languages().join("+");
}

function ensurePrepared() {
  if (!prepared) {
    prepared = prepare().catch((error) => {
      prepared = null;
      throw error;
    });
  }
  return prepared;
}

function settle(id, handler) {
  const job = pending.get(id);
  if (!job) return;

  clearTimeout(job.timer);
  pending.delete(id);
  handler(job);
}

function getWorker() {
  if (worker) return worker;

  const current = new Worker(WORKER_PATH, {
    workerData: { languages: languages(), cachePath: cachePath() },
  });
  worker = current;

  current.on("message", ({ id, text, confidence, error }) => {
    settle(id, (job) =>
      error ? job.reject(new Error(error)) : job.resolve({ text: text || "", confidence: Number(confidence) || 0 })
    );
  });

  // Only this worker's jobs may be rejected here: `pending` is shared, and a
  // dead worker's late exit must not cancel a replacement worker's job.
  const fail = (reason) => {
    if (worker === current) worker = null;
    for (const [id, job] of [...pending.entries()]) {
      if (job.worker === current) settle(id, (entry) => entry.reject(new Error(reason)));
    }
  };

  current.on("error", (error) => {
    lastError = error.message;
    fail(`local OCR worker failed: ${error.message}`);
    // The cache is the likeliest reason a fresh worker dies; the next attempt
    // downloads it again instead of repeating the same failure.
    invalidateCache().catch(() => {});
  });
  current.on("exit", (code) => {
    if (worker === current) worker = null;
    if (code !== 0) fail(`local OCR worker exited with code ${code}`);
  });

  // The worker must not hold the process open on shutdown.
  current.unref();
  return current;
}

function send(job, timeoutMs) {
  const id = nextJobId;
  nextJobId += 1;

  return new Promise((resolve, reject) => {
    let current;
    try {
      current = getWorker();
    } catch (error) {
      reject(error);
      return;
    }

    const timer = setTimeout(() => {
      settle(id, (entry) => entry.reject(new Error(`local OCR timed out after ${timeoutMs} ms`)));
      // A timed-out recognition would keep the thread busy with the next job.
      terminate(current).catch(() => {});
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

async function terminate(owner = worker) {
  if (worker === owner) worker = null;
  if (owner) await owner.terminate().catch(() => {});
}

/**
 * @param {Buffer} buffer image bytes
 * @returns {Promise<{text: string, confidence: number}>}
 */
function recognize(buffer) {
  if (!enabled() || Date.now() < pausedUntil) return Promise.resolve(EMPTY);

  const job = queue.then(async () => {
    try {
      await ensurePrepared();
      const result = await send(
        { type: "recognize", buffer },
        timeoutFromEnv("IMAGE_SPAM_LOCAL_OCR_TIMEOUT_MS", RECOGNIZE_TIMEOUT_MS)
      );
      failures = 0;
      lastError = "";
      return result;
    } catch (error) {
      lastError = error.message;
      failures += 1;
      if (failures >= FAILURES_BEFORE_PAUSE) pausedUntil = Date.now() + PAUSE_MS;
      // A failed read is not fatal: the vision verdict and the caption still
      // decide, exactly as they did when this path had no OCR at all.
      return EMPTY;
    }
  });

  queue = job.catch(() => {});
  return job;
}

/**
 * Download the language data and load the model ahead of the first image.
 *
 * @returns {Promise<string>} the configured language list
 */
async function preload() {
  await ensurePrepared();
  const result = await send(
    { type: "preload" },
    timeoutFromEnv("IMAGE_SPAM_LOCAL_OCR_START_TIMEOUT_MS", START_TIMEOUT_MS)
  );
  return result.text || languages().join("+");
}

/**
 * @returns {Promise<void>}
 */
async function stop() {
  pausedUntil = 0;
  failures = 0;
  lastError = "";
  await terminate();
}

/**
 * Current module state, for status output and tests.
 *
 * @returns {{enabled: boolean, failures: number, pausedUntil: number, languages: string[], lastError: string}}
 */
function status() {
  return { enabled: enabled(), failures, pausedUntil, languages: languages(), lastError };
}

module.exports = { prepare, recognize, preload, stop, status };
