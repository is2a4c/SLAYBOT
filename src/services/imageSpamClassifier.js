const sharp = require("sharp");
const localVision = require("./vision/localVision");

const DEFAULT_THRESHOLD = 70;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 15_000;
const MAX_PENDING_ANALYSES = 2;
const IMAGE_EXTENSIONS = /\.(?:avif|gif|jpe?g|png|webp)$/i;
const { proxyDispatcher, resolveProvider } = require("./ai/visionProvider");

// How many of the prepared regions are transcribed. One is the full frame.
const OCR_REGIONS = Math.max(1, Number.parseInt(process.env.IMAGE_SPAM_OCR_REGIONS, 10) || 1);

// io.net is not always usable even with a valid key — an account out of credits
// answers 429 to everything. Retrying it per image would add its latency to
// every message, so repeated failures park it for a while and moderation falls
// back to the local model instead of failing outright.
const IO_FAILURES_BEFORE_PAUSE = 3;
const IO_PAUSE_MS = 10 * 60_000;
const ioBreaker = { failures: 0, pausedUntil: 0, reason: "" };

function ioAvailable() {
  if (!resolveProvider().configured) return false;
  return Date.now() >= ioBreaker.pausedUntil;
}

/**
 * @param {Error} error
 * @param {object} [logger]
 */
function noteIoFailure(error, logger) {
  ioBreaker.failures += 1;
  ioBreaker.reason = error.message;

  if (ioBreaker.failures >= IO_FAILURES_BEFORE_PAUSE && Date.now() >= ioBreaker.pausedUntil) {
    ioBreaker.pausedUntil = Date.now() + IO_PAUSE_MS;
    logger?.warn?.(
      `io.net paused for ${IO_PAUSE_MS / 60000} minutes after ${ioBreaker.failures} failures: ${error.message}`
    );
  }
}

function noteIoSuccess() {
  ioBreaker.failures = 0;
  ioBreaker.pausedUntil = 0;
  ioBreaker.reason = "";
}

/**
 * Current state of the io.net breaker, for status output and tests.
 * @returns {{available: boolean, failures: number, pausedUntil: number, reason: string}}
 */
function ioStatus() {
  return { available: ioAvailable(), ...ioBreaker };
}

let visionQueue = Promise.resolve();
let ocrQueue = Promise.resolve();
let pendingAnalyses = 0;

function isImageAttachment(attachment) {
  return attachment.contentType?.toLowerCase().startsWith("image/") || IMAGE_EXTENSIONS.test(attachment.name || "");
}

const OCR_PROMPT = [
  "Transcribe every piece of text visible in this image, exactly as written, keeping line breaks.",
  "Text may be in Russian or English. Do not translate, summarise or explain it.",
  'Answer with JSON only: {"text": "<the transcription>", "confidence": <0-100>}.',
  "confidence is how legible the text was. Use an empty string and 0 when there is no readable text.",
].join(" ");

/**
 * Read the transcription out of a chat completion.
 *
 * The model is asked for JSON but sometimes wraps it in prose or a code fence,
 * so the object is dug out rather than parsed off the whole reply. Anything
 * unparseable counts as "nothing read", which downstream already handles.
 *
 * @param {string} reply
 * @returns {{text: string, confidence: number}}
 */
function parseOcrResponse(reply) {
  const empty = { text: "", confidence: 0 };
  if (typeof reply !== "string") return empty;

  const json = reply.match(/\{[\s\S]*\}/)?.[0];
  if (!json) return empty;

  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch {
    return empty;
  }

  const text = typeof parsed.text === "string" ? parsed.text.trim() : "";
  if (!text) return empty;

  const confidence = Number(parsed.confidence);
  return {
    text,
    // A transcription with no usable score is treated as readable; an explicit
    // low score still gates the text downstream.
    confidence: Number.isFinite(confidence) ? Math.min(100, Math.max(0, confidence)) : 100,
  };
}

/**
 * Read the text in an image with io.net.
 *
 * @param {Buffer} buffer PNG bytes
 * @returns {Promise<{text: string, confidence: number}>}
 */
async function runIoOcr(buffer) {
  const provider = resolveProvider();
  if (!provider.configured || !ioAvailable()) return { text: "", confidence: 0 };

  const requestedTimeout = Number.parseInt(process.env.IMAGE_SPAM_OCR_TIMEOUT_MS, 10);
  const timeoutMs = Number.isInteger(requestedTimeout) && requestedTimeout > 0 ? requestedTimeout : 45_000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${provider.baseURL}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${provider.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.IMAGE_SPAM_OCR_MODEL || provider.model,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: OCR_PROMPT },
              { type: "image_url", image_url: { url: `data:image/png;base64,${buffer.toString("base64")}` } },
            ],
          },
        ],
        temperature: 0,
        max_tokens: 1024,
      }),
      signal: controller.signal,
      dispatcher: proxyDispatcher(),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`${provider.label} OCR returned HTTP ${response.status} ${detail.slice(0, 120)}`.trim());
    }

    const payload = await response.json();
    noteIoSuccess();
    return parseOcrResponse(payload?.choices?.[0]?.message?.content);
  } catch (error) {
    const failure =
      error.name === "AbortError" ? new Error(`${provider.label} OCR timed out after ${timeoutMs} ms`) : error;
    noteIoFailure(failure);
    // A failed transcription is not fatal: scoring still has the caption and
    // the visual verdict to work with.
    return { text: "", confidence: 0 };
  } finally {
    clearTimeout(timeout);
  }
}

const ANALYSIS_PROMPT = [
  "You are a Discord anti-spam reviewer looking at one image. Do two things at once.",
  "1) Transcribe every piece of text visible in the image, exactly as written, keeping line breaks.",
  "Text may be in Russian or English. Do not translate it.",
  "2) Decide whether the image is a get-rich-quick or reward scam. Scam traits: fake bank transfers or",
  "payment confirmations, casino or betting balances, in-game currency giveaways, 'claim your reward /",
  "free money for new users / register to withdraw' promos, crypto wallets and success screens.",
  "One fraudulent panel inside a collage is enough. Ordinary memes, games, chats and real personal",
  "screenshots are safe. Judge the picture itself, not only the text.",
  'Answer with JSON only: {"text": "<transcription>", "confidence": <0-100>, "verdict": "IMAGE_SPAM" or "IMAGE_SAFE"}.',
  "confidence is how legible the text was; use an empty string and 0 when there is none.",
].join(" ");

/**
 * Transcription and verdict from one reply.
 *
 * @param {string} reply
 * @returns {{text: string, confidence: number, verdict: string|null}}
 */
function parseAnalysisResponse(reply) {
  const read = parseOcrResponse(reply);
  const verdict = typeof reply === "string" ? [...reply.matchAll(/\bIMAGE_(SPAM|SAFE)\b/gi)].at(-1)?.[1] : null;

  return { ...read, verdict: verdict ? `IMAGE_${verdict.toUpperCase()}` : null };
}

/**
 * Ask for the text and the verdict together.
 *
 * Two separate calls meant two round-trips and twice the quota for the same
 * image, and the second one only ever received what the first had read.
 *
 * @param {Buffer} buffer PNG bytes
 * @param {string} caption
 * @returns {Promise<{text: string, confidence: number, verdict: string|null}>}
 */
async function runIoAnalysis(buffer, caption = "") {
  const provider = resolveProvider();
  const requestedTimeout = Number.parseInt(process.env.IMAGE_SPAM_OCR_TIMEOUT_MS, 10);
  const timeoutMs = Number.isInteger(requestedTimeout) && requestedTimeout > 0 ? requestedTimeout : 45_000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${provider.baseURL}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${provider.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.IMAGE_SPAM_OCR_MODEL || provider.model,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: `${ANALYSIS_PROMPT} Caption: ${JSON.stringify(caption || "")}` },
              { type: "image_url", image_url: { url: `data:image/png;base64,${buffer.toString("base64")}` } },
            ],
          },
        ],
        temperature: 0,
        max_tokens: 1024,
      }),
      signal: controller.signal,
      dispatcher: proxyDispatcher(),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`${provider.label} returned HTTP ${response.status} ${detail.slice(0, 120)}`.trim());
    }

    const payload = await response.json();
    noteIoSuccess();
    return parseAnalysisResponse(payload?.choices?.[0]?.message?.content);
  } catch (error) {
    if (error.name === "AbortError") throw new Error(`${provider.label} timed out after ${timeoutMs} ms`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * @param {Buffer} buffer
 * @returns {Promise<{text: string, confidence: number}>}
 */
async function recognize(buffer) {
  // Kept serial: several attachments on one message would otherwise fire off
  // that many concurrent requests against the same rate limit.
  const job = ocrQueue.then(() => runIoOcr(buffer));
  ocrQueue = job.catch(() => {});
  return job;
}

async function recognizeAll(buffers) {
  const results = [];
  for (const buffer of buffers) results.push(await recognize(buffer));
  return {
    text: results
      .map((result) => result.text.trim())
      .filter(Boolean)
      .join("\n"),
    confidence: Math.max(0, ...results.map((result) => result.confidence)),
    candidates: results,
  };
}

async function downloadImage(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`image download returned HTTP ${response.status}`);

    const declaredSize = Number(response.headers.get("content-length"));
    if (declaredSize > MAX_IMAGE_BYTES) throw new Error("image is larger than 8 MB");

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_IMAGE_BYTES) throw new Error("image is larger than 8 MB");
    return buffer;
  } finally {
    clearTimeout(timeout);
  }
}

async function prepareImage(buffer, { tiles = 4 } = {}) {
  const image = sharp(buffer, { animated: false, limitInputPixels: 30_000_000 });
  const [metadata, stats, visionBase] = await Promise.all([
    image.metadata(),
    image.stats(),
    image
      .clone()
      .rotate()
      .resize({ width: 1800, height: 1800, fit: "inside", withoutEnlargement: false })
      .png()
      .toBuffer(),
  ]);

  const prepared = await sharp(visionBase).grayscale().normalize().sharpen().png().toBuffer();
  const visual = {
    width: metadata.width || 0,
    height: metadata.height || 0,
    entropy: stats.entropy || 0,
  };

  // Cutting regions costs a second of CPU each time. Skip it when only the full
  // frame is going to be looked at.
  if (!tiles) return { ocrImages: [prepared], visionImages: [visionBase], visual };

  const preparedMetadata = await sharp(prepared).metadata();
  const width = preparedMetadata.width;
  const height = preparedMetadata.height;
  const tileWidth = Math.ceil(width * 0.55);
  const tileHeight = Math.ceil(height * 0.55);
  const regions = [
    [0, 0],
    [width - tileWidth, 0],
    [0, height - tileHeight],
    [width - tileWidth, height - tileHeight],
  ];
  const [ocrTiles, visionTiles] = await Promise.all([
    Promise.all(
      regions.map(([left, top]) =>
        sharp(prepared)
          .extract({ left, top, width: tileWidth, height: tileHeight })
          .resize({ width: 1800, withoutEnlargement: false })
          .threshold(180)
          .png()
          .toBuffer()
      )
    ),
    Promise.all(
      regions.map(([left, top]) =>
        sharp(visionBase)
          .extract({ left, top, width: tileWidth, height: tileHeight })
          .resize({ width: 1200, withoutEnlargement: false })
          .png()
          .toBuffer()
      )
    ),
  ]);

  return {
    // Keep the full frame for context and inspect four overlapping regions so
    // small panels in a collage are not lost when the full image is downscaled.
    ocrImages: [prepared, ...ocrTiles],
    visionImages: [visionBase, ...visionTiles],
    visual,
  };
}

const VISION_SPLIT = process.env.IMAGE_SPAM_VISION_SPLIT !== "false";

function buildVisionPrompt(caption, ocrHint = "") {
  return (
    "You are a Discord anti-spam reviewer. Decide if any supplied image is a get-rich-quick / reward scam. " +
    "Scam traits: fake bank transfers or payment confirmations (e.g. Ozon, Sber, Tinkoff, a big +amount in ₽/$), " +
    "in-game or app currency balances and coin/token giveaways (e.g. 'Coins', 'Balance'), casino or betting balances, " +
    "'claim your reward / free money for new users / register to withdraw' promos, crypto wallets, and success screens. " +
    "A single fraudulent panel inside a collage is enough. Ordinary memes, games, chats and real personal screenshots are safe. " +
    "Judge the pictures themselves, not only the text. Reply with exactly one label: IMAGE_SPAM or IMAGE_SAFE. " +
    `Caption: ${JSON.stringify(caption || "")}. ` +
    `OCR text found in the image: ${JSON.stringify(ocrHint.slice(0, 1200))}`
  );
}

async function runLocalVision(buffer, caption, ocrHint = "", split = VISION_SPLIT) {
  // Handed to a worker thread: generation is a token loop with tensor work in
  // between, and running it here freezes the gateway for its whole duration.
  const job = visionQueue.then(() =>
    localVision.describe({ buffer, prompt: buildVisionPrompt(caption, ocrHint), split })
  );
  visionQueue = job.catch(() => {});
  return job;
}

async function runIoVision(buffers, caption, ocrHint = "") {
  const provider = resolveProvider();
  if (!provider.configured) throw new Error("no vision provider is configured");

  const requestedTimeout = Number.parseInt(process.env.IMAGE_SPAM_REMOTE_TIMEOUT_MS, 10);
  const timeoutMs = Number.isInteger(requestedTimeout) && requestedTimeout > 0 ? requestedTimeout : 45_000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const content = [{ type: "text", text: buildVisionPrompt(caption, ocrHint) }];
    for (const buffer of buffers) {
      content.push({
        type: "image_url",
        image_url: { url: `data:image/png;base64,${buffer.toString("base64")}` },
      });
    }

    const response = await fetch(`${provider.baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${provider.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.IMAGE_SPAM_REMOTE_MODEL || provider.model,
        messages: [{ role: "user", content }],
        temperature: 0,
        max_tokens: 64,
      }),
      signal: controller.signal,
      dispatcher: proxyDispatcher(),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`${provider.label} vision returned HTTP ${response.status} ${detail.slice(0, 120)}`.trim());
    }

    const payload = await response.json();
    const result = payload?.choices?.[0]?.message?.content;
    if (typeof result !== "string") throw new Error(`${provider.label} vision returned an invalid response`);
    return result;
  } catch (error) {
    if (error.name === "AbortError") throw new Error(`${provider.label} vision timed out after ${timeoutMs} ms`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function parseVisionResponse(text, source = "local vision") {
  const label = [...text.matchAll(/\bIMAGE_(SPAM|SAFE)\b/gi)].at(-1)?.[1]?.toUpperCase();
  if (!label) throw new Error(`${source} returned no classification: ${text.slice(-500)}`);
  if (label === "SPAM") {
    return { score: 85, reasons: [`${source} detected financial reward spam`], detectedText: "" };
  }
  return { score: 10, reasons: [`${source} found no convincing spam pattern`], detectedText: "" };
}

async function analyzeWithVision(buffer, caption, engine = runLocalVision, ocrHint = "", split = VISION_SPLIT) {
  const result = parseVisionResponse(await engine(buffer, caption, ocrHint, split));
  const modelName = (process.env.IMAGE_SPAM_VISION_MODEL || "SmolVLM-500M-Instruct").split("/").pop();
  return { ...result, model: `${modelName} (${process.env.IMAGE_SPAM_VISION_DTYPE || "q4"})` };
}

function selectVisionIndexes(visionImages, candidates, caption) {
  const requestedMax = Number.parseInt(process.env.IMAGE_SPAM_VISION_MAX_REGIONS, 10);
  // Analysing every prepared region was meant for a local model that could not
  // see detail in a downscaled frame. A remote model reads the full frame, so
  // the extra regions only cost latency and quota; locally they cost minutes of
  // CPU. Both defaults are deliberately small and can be raised.
  const defaultMax = ioAvailable() ? 1 : 2;
  const maxRegions = Math.min(
    Number.isInteger(requestedMax) && requestedMax > 0 ? requestedMax : defaultMax,
    visionImages.length
  );
  const rankedTiles = visionImages
    .map((_, index) => index)
    .slice(1)
    .sort((left, right) => {
      const risk = (index) => {
        const candidate = candidates[index] || { text: "", confidence: 0 };
        return scoreImageSpam({
          caption,
          ocrText: candidate.text,
          confidence: candidate.confidence,
        }).score;
      };
      return risk(right) - risk(left);
    });
  return maxRegions === visionImages.length
    ? visionImages.map((_, index) => index)
    : [0, ...rankedTiles].slice(0, maxRegions);
}

async function analyzeVisionImages(visionImages, candidates, caption, engine) {
  const selectedIndexes = selectVisionIndexes(visionImages, candidates, caption);
  if (!engine && ioAvailable()) {
    const ocrHint = selectedIndexes
      .map((index) => candidates[index])
      .filter((candidate) => candidate && candidate.confidence >= 25 && candidate.text)
      .map((candidate) => candidate.text)
      .join("\n");

    try {
      const result = parseVisionResponse(
        await runIoVision(
          selectedIndexes.map((index) => visionImages[index]),
          caption,
          ocrHint
        ),
        `${resolveProvider().label} vision`
      );
      noteIoSuccess();

      const provider = resolveProvider();
      return {
        ...result,
        model: `${process.env.IMAGE_SPAM_REMOTE_MODEL || provider.model} (${provider.label})`,
        index: selectedIndexes[0],
        regionsAnalyzed: selectedIndexes.length,
        regionsAvailable: visionImages.length,
      };
    } catch (error) {
      // Out of credits, rate limited or unreachable: fall through to the local
      // model rather than leaving the image unchecked.
      noteIoFailure(error);
    }
  }

  const selectedEngine = engine || runLocalVision;
  const results = [];
  for (const index of selectedIndexes) {
    const candidate = candidates[index] || { text: "", confidence: 0 };
    const ocrHint = candidate.confidence >= 25 ? candidate.text : "";
    const result = await analyzeWithVision(
      visionImages[index],
      caption,
      selectedEngine,
      ocrHint,
      index === 0 ? VISION_SPLIT : false
    );
    results.push({ ...result, index });
  }
  const strongest = results.reduce((best, result) => (result.score > best.score ? result : best));
  return {
    ...strongest,
    regionsAnalyzed: results.length,
    regionsAvailable: visionImages.length,
  };
}

async function preloadVisionModel() {
  const provider = resolveProvider();
  if (provider.configured) return process.env.IMAGE_SPAM_REMOTE_MODEL || provider.model;

  return localVision.preload();
}

function scoreImageSpam({ caption = "", ocrText = "", confidence = 0, visual = {} }) {
  const combined = `${caption}\n${ocrText}`.toLowerCase().replace(/[|]/g, "i");
  const reasons = [];
  let score = 0;

  const add = (points, reason) => {
    score += points;
    reasons.push(`${reason} (+${points})`);
  };

  const amounts = [...combined.matchAll(/(?:[$€£]\s*|\b)(\d[\d,. ]{2,})(?:\s*(?:usd|eur|gbp|usdt))?\b/gi)]
    .map((match) => Number(match[1].replace(/[ ,.]/g, "")))
    .filter((amount) => amount >= 500);
  if (amounts.length) add(amounts.some((amount) => amount >= 1000) ? 25 : 15, `large money amount (${amounts[0]})`);

  const payoutTerms =
    combined.match(/\b(withdraw(?:al|n)?|claim(?:ed)?|reward|payout|profit|earn(?:ed|ings)?|bonus)\b/g) || [];
  if (payoutTerms.length) add(Math.min(30, 15 + (new Set(payoutTerms).size - 1) * 5), "payout/reward language");

  if (/\b(success(?:ful|fully)?|received|approved|completed|paid|payment)\b/.test(combined)) {
    add(15, "successful payment language");
  }

  if (/\b(crypto|bitcoin|btc|ethereum|eth|usdt|wallet|coinbase|binance|blockchain)\b/.test(combined)) {
    add(20, "crypto/wallet language");
  }

  const hasWalletAddress = /\b(?:bc1|[13])[a-z0-9]{25,62}\b/i.test(combined) || /\b0x[a-f0-9]{40}\b/i.test(combined);
  if (hasWalletAddress) add(25, "cryptocurrency wallet address");

  if (/\b(click|tap|visit|dm me|check this|check it|limited time)\b/.test(combined)) add(8, "call to action");
  const hasBaitLanguage = /\b(bro|guys?|mate|friend)\b/.test(combined);
  if (hasBaitLanguage && (caption.trim().length < 40 || ocrText.length > 0)) {
    add(5, "short conversational bait");
  }

  // Multilingual (RU) gambling / giveaway scam signals. SLAYBOT's audience is
  // Russian-speaking, and these phrasings dominate Discord casino-referral scams.
  const gambling =
    combined.match(
      /(казино|казик|ставк|рулетк|слот[аовы]|джекпот|casino|roulette|jackpot|gambling|1xbet|mostbet|melbet|pin.?up|vavada)/gi
    ) || [];
  if (gambling.length) add(30, "gambling/casino reference");

  // Deliberately excludes banking-ambiguous words (пополнить, вывод, баланс) so a
  // genuine balance screenshot is not flagged on its own.
  const giveawayRu =
    combined.match(
      /(разда[ёе]т|раздач|бонус|промокод|подар[оки]|беспл|каждому|нов(?:ым|ому)\s+(?:игрок|пользовател)|регистрац|выигр|заработ)/gi
    ) || [];
  if (giveawayRu.length) {
    add(
      Math.min(30, 12 + (new Set(giveawayRu.map((match) => match.toLowerCase())).size - 1) * 6),
      "reward/giveaway bait"
    );
  }

  const knownScamBrand = /(мелл?стро[йи]|mellstro|mellget|1xbet|mostbet|melbet|vavada)/i.test(combined);
  const promoDomain = combined.match(
    /\b([a-z0-9-]{3,}\.(?:com|net|ru|cc|xyz|org|io|vip|bet|casino|club|online|site))\b/i
  );
  if (knownScamBrand) add(30, "known scam brand");
  else if (promoDomain && (gambling.length || giveawayRu.length)) add(18, `promo domain (${promoDomain[1]})`);

  // Fake bank-transfer / payment-proof screenshots only count as a signal alongside
  // scam context — a real balance screenshot must never be flagged on its own.
  const banking =
    /(банк|баланс|перевод|сч[её]т|пополн|\bozon\b|сбер|тинькофф|tinkoff|qiwi|kaspi|перевести|₽|\bруб)/i.test(combined);
  const scamContext = gambling.length || giveawayRu.length || knownScamBrand;
  if (banking && amounts.length && scamContext) add(20, "banking payment proof with scam context");

  const ocrLines = ocrText.split(/\n+/).filter((line) => line.trim().length >= 3).length;
  const landscape = visual.width > visual.height * 1.15;
  const screenshotLike = visual.entropy >= 4.5 && ocrLines >= 4;
  if (score >= 25 && screenshotLike) add(8, "text-heavy screenshot");
  if (score >= 35 && screenshotLike && landscape) add(7, "collage-like landscape layout");
  if (amounts.length && screenshotLike && landscape && hasBaitLanguage) {
    add(25, "large payout screenshot paired with conversational bait");
  }

  // Low-confidence OCR may contain hallucinated fragments. A caption can add
  // context, but must not turn unreliable OCR into an automatic deletion.
  if (confidence < 25) score = Math.min(score, DEFAULT_THRESHOLD - 1);

  return { score: Math.min(100, score), reasons };
}

function combineImageSpamResults(results, { caption = "", threshold = DEFAULT_THRESHOLD } = {}) {
  if (!results.length) {
    return {
      score: 0,
      risky: false,
      threshold,
      reasons: [],
      ocrText: "",
      confidence: 0,
      model: "unavailable",
      strongestIndex: -1,
    };
  }

  const strongest = results.reduce((best, result) => (result.score > best.score ? result : best));
  const reliableOcrResults = results.filter(
    (result) => result.ocrText?.trim() && (Number(result.confidence) || 0) >= 25
  );
  const ocrText = reliableOcrResults
    .map((result) => {
      return `Image ${result.imageIndex + 1}:\n${result.ocrText.trim()}`;
    })
    .join("\n\n");
  const confidence = Math.max(0, ...reliableOcrResults.map((result) => Number(result.confidence) || 0));
  const contextual = scoreImageSpam({
    caption,
    ocrText,
    confidence,
  });
  const score = Math.max(strongest.score, contextual.score);
  const models = [...new Set(results.map((result) => result.model).filter(Boolean))];
  const reasons = [
    `all ${results.length} image(s) analyzed as one message`,
    ...(contextual.score > strongest.score
      ? contextual.reasons.map((reason) => `combined image context: ${reason}`)
      : (strongest.reasons || []).map((reason) => `image ${strongest.imageIndex + 1}: ${reason}`)),
  ];

  return {
    score,
    risky: results.some((result) => result.risky) || score >= threshold,
    threshold,
    reasons,
    ocrText: ocrText.slice(0, 2000),
    confidence: Math.round(confidence),
    model: models.join(", ") || "unavailable",
    strongestIndex: strongest.imageIndex,
  };
}

function selectVisionCandidate({ candidates = [] }, visionImages, caption, visual) {
  let selectedIndex = 0;
  let selectedScore = -1;
  for (let index = 0; index < candidates.length && index < visionImages.length; index += 1) {
    const candidate = candidates[index];
    const score = scoreImageSpam({
      caption,
      ocrText: candidate.text,
      confidence: candidate.confidence,
      visual,
    }).score;
    if (score > selectedScore) {
      selectedIndex = index;
      selectedScore = score;
    }
  }
  const selected = candidates[selectedIndex] || { text: "", confidence: 0 };
  return {
    buffer: visionImages[selectedIndex] || visionImages[0],
    index: selectedIndex,
    ocrHint: selected.confidence >= 25 ? selected.text : "",
    ocrRisk: Math.max(0, selectedScore),
    confidence: selected.confidence,
  };
}

async function classifyImage({ url, caption = "", threshold = DEFAULT_THRESHOLD, guildId }) {
  const buffer = await downloadImage(url);
  return classifyImageBuffer({ buffer, caption, threshold, guildId });
}

async function classifyImageBuffer({
  buffer,
  caption = "",
  threshold = DEFAULT_THRESHOLD,
  guildId,
  localOnly = false,
}) {
  if (pendingAnalyses >= MAX_PENDING_ANALYSES) throw new Error("image classifier is busy");
  pendingAnalyses += 1;
  try {
    if (!localOnly && guildId) {
      const distributed = await require("../slaynode/control/runtime").dispatchImageSpam({
        buffer,
        caption,
        threshold,
        guildId,
      });
      if (distributed) return distributed;
    }
    // A remote model reads the whole frame, so the regions are only cut when the
    // local model — which cannot — is the one doing the looking.
    const remote = ioAvailable();
    const { ocrImages, visionImages, visual } = await prepareImage(buffer, { tiles: remote ? 0 : 4 });

    let ocr;
    let vision;

    if (remote) {
      // One call answers both questions about the same image.
      try {
        const analysis = await runIoAnalysis(ocrImages[0], caption);
        const provider = resolveProvider();

        ocr = {
          text: analysis.text,
          confidence: analysis.confidence,
          candidates: [{ text: analysis.text, confidence: analysis.confidence }],
        };
        vision = {
          ...parseVisionResponse(analysis.verdict || "IMAGE_SAFE", `${provider.label} vision`),
          model: `${process.env.IMAGE_SPAM_OCR_MODEL || provider.model} (${provider.label})`,
          index: 0,
          regionsAnalyzed: 1,
          regionsAvailable: 1,
        };
      } catch (error) {
        noteIoFailure(error);
        ocr = undefined;
      }
    }

    if (!ocr) {
      // Local path: no transcription is available, so the verdict carries it.
      const prepared = visionImages.length > 1 ? { ocrImages, visionImages } : await prepareImage(buffer, { tiles: 4 });
      ocr = await recognizeAll(prepared.ocrImages.slice(0, OCR_REGIONS));
      vision = await analyzeVisionImages(prepared.visionImages, ocr.candidates, caption);
    }

    const selected = selectVisionCandidate(ocr, visionImages, caption, visual);
    const result = scoreImageSpam({
      caption,
      ocrText: ocr.text,
      confidence: selected.confidence,
      visual,
    });
    const combinedReasons = [
      `region: ${selected.index === 0 ? "full image" : `tile ${selected.index}`} selected (${selected.ocrRisk}/100 OCR risk)`,
      `vision: ${vision.regionsAnalyzed}/${vision.regionsAvailable} regions analyzed; strongest was ${
        vision.index === 0 ? "full image" : `tile ${vision.index}`
      }`,
      ...vision.reasons.map((reason) => `vision: ${reason}`),
      ...result.reasons.map((reason) => `OCR/caption: ${reason}`),
    ];
    const combinedText = [vision.detectedText, ocr.text].filter(Boolean).join("\n");
    const combinedScore = Math.min(
      100,
      Math.max(vision.score, result.score) + (vision.score >= 50 && result.score >= 50 ? 10 : 0)
    );

    return {
      score: combinedScore,
      reasons: combinedReasons,
      risky: combinedScore >= threshold,
      threshold,
      ocrText: combinedText.trim().slice(0, 500),
      confidence: Math.round(selected.confidence),
      model: vision.model,
    };
  } finally {
    pendingAnalyses -= 1;
  }
}

module.exports = {
  DEFAULT_THRESHOLD,
  classifyImage,
  classifyImageBuffer,
  isImageAttachment,
  scoreImageSpam,
  analyzeWithVision,
  analyzeVisionImages,
  combineImageSpamResults,
  ioAvailable,
  ioStatus,
  parseAnalysisResponse,
  noteIoSuccess,
  parseOcrResponse,
  parseVisionResponse,
  preloadVisionModel,
  prepareImage,
  recognizeAll,
  runIoOcr,
  runIoVision,
  selectVisionCandidate,
};
