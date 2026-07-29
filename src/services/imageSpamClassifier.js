const sharp = require("sharp");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createWorker, PSM } = require("tesseract.js");

const OCR_LANGS = ["eng", "rus"];

const DEFAULT_THRESHOLD = 70;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 15_000;
const MAX_PENDING_ANALYSES = 2;
const IMAGE_EXTENSIONS = /\.(?:avif|gif|jpe?g|png|webp)$/i;
const IO_API_URL = "https://api.intelligence.io.solutions/api/v1/chat/completions";
const DEFAULT_IO_MODEL = "meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8";

let workerPromise;
let localVisionPromise;
let visionQueue = Promise.resolve();
let ocrQueue = Promise.resolve();
let pendingAnalyses = 0;

function isImageAttachment(attachment) {
  return attachment.contentType?.toLowerCase().startsWith("image/") || IMAGE_EXTENSIONS.test(attachment.name || "");
}

// Tesseract needs every requested language's traineddata in a single langPath
// directory, so gather them from their per-package folders into one cache dir.
function prepareLangPath() {
  const cacheRoot = process.env.IMAGE_SPAM_MODEL_CACHE || path.join(process.cwd(), ".cache", "image-spam");
  const langPath = path.join(cacheRoot, "tessdata");
  fs.mkdirSync(langPath, { recursive: true });
  for (const code of OCR_LANGS) {
    const pkg = require(`@tesseract.js-data/${code}`);
    const file = `${code}.traineddata.gz`;
    const dest = path.join(langPath, file);
    if (!fs.existsSync(dest)) fs.copyFileSync(path.join(pkg.langPath, file), dest);
  }
  return langPath;
}

async function getWorker() {
  if (!workerPromise) {
    const langPath = prepareLangPath();
    // Russian is bundled alongside English: the bot's audience is Russian-speaking,
    // and English-only OCR turned Cyrillic scam text into unusable noise.
    workerPromise = createWorker(OCR_LANGS, 1, {
      langPath,
      gzip: true,
      cacheMethod: "none",
      logger: () => {},
    })
      .then(async (worker) => {
        await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
        return worker;
      })
      .catch((error) => {
        workerPromise = undefined;
        throw error;
      });
  }
  return workerPromise;
}

async function recognize(buffer) {
  const job = ocrQueue.then(async () => {
    const worker = await getWorker();
    const result = await worker.recognize(buffer);
    return {
      text: result.data.text || "",
      confidence: Number(result.data.confidence) || 0,
    };
  });
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

async function prepareImage(buffer) {
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
    visual: {
      width: metadata.width || 0,
      height: metadata.height || 0,
      entropy: stats.entropy || 0,
    },
  };
}

async function getLocalVision() {
  if (!localVisionPromise) {
    localVisionPromise = (async () => {
      const { env, AutoProcessor, AutoModelForImageTextToText, RawImage } = await import("@huggingface/transformers");
      env.cacheDir = process.env.IMAGE_SPAM_MODEL_CACHE || path.join(process.cwd(), ".cache", "image-spam");
      // The 500M model keeps moderation responsive on CPU-only hosts. Operators
      // with sufficient capacity can explicitly select the larger 2.2B model.
      const modelId = process.env.IMAGE_SPAM_VISION_MODEL || "HuggingFaceTB/SmolVLM-500M-Instruct";
      // dtype and model are configurable: a larger model or higher precision reads
      // image intent far better, at the cost of RAM and CPU latency.
      const dtype = process.env.IMAGE_SPAM_VISION_DTYPE || "q4";
      const requestedThreads = Number.parseInt(process.env.IMAGE_SPAM_ONNX_THREADS, 10);
      const availableThreads = os.availableParallelism?.() || os.cpus().length;
      const inferenceThreads =
        Number.isInteger(requestedThreads) && requestedThreads > 0
          ? Math.min(requestedThreads, availableThreads)
          : Math.max(1, Math.floor(availableThreads / 2));
      const [processor, model] = await Promise.all([
        AutoProcessor.from_pretrained(modelId),
        AutoModelForImageTextToText.from_pretrained(modelId, {
          dtype,
          device: "cpu",
          session_options: {
            intraOpNumThreads: inferenceThreads,
            interOpNumThreads: 1,
          },
        }),
      ]);
      return { processor, model, RawImage, modelId, inferenceThreads };
    })().catch((error) => {
      localVisionPromise = undefined;
      throw error;
    });
  }
  return localVisionPromise;
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
  const runtime = await getLocalVision();
  const job = visionQueue.then(async () => {
    const prompt = buildVisionPrompt(caption, ocrHint);
    const messages = [{ role: "user", content: [{ type: "image" }, { type: "text", text: prompt }] }];
    const formatted = runtime.processor.tokenizer.apply_chat_template(messages, {
      add_generation_prompt: true,
      tokenize: false,
    });
    const image = await runtime.RawImage.fromBlob(new Blob([buffer], { type: "image/jpeg" }));
    const inputs = await runtime.processor(formatted, image, { do_image_splitting: split });
    const output = await runtime.model.generate({ ...inputs, max_new_tokens: 8, do_sample: false });
    return runtime.processor.tokenizer.batch_decode(output, { skip_special_tokens: true })[0] || "";
  });
  visionQueue = job.catch(() => {});
  return job;
}

async function runIoVision(buffers, caption, ocrHint = "") {
  const apiKey = process.env.IO_INTELLIGENCE_API_KEY;
  if (!apiKey) throw new Error("IO_INTELLIGENCE_API_KEY is not configured");

  const requestedTimeout = Number.parseInt(process.env.IMAGE_SPAM_REMOTE_TIMEOUT_MS, 10);
  const timeoutMs =
    Number.isInteger(requestedTimeout) && requestedTimeout > 0 ? requestedTimeout : 45_000;
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

    const response = await fetch(IO_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.IMAGE_SPAM_REMOTE_MODEL || DEFAULT_IO_MODEL,
        messages: [{ role: "user", content }],
        temperature: 0,
        max_tokens: 64,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`io.net vision returned HTTP ${response.status}`);
    }

    const payload = await response.json();
    const result = payload?.choices?.[0]?.message?.content;
    if (typeof result !== "string") throw new Error("io.net vision returned an invalid response");
    return result;
  } catch (error) {
    if (error.name === "AbortError") throw new Error(`io.net vision timed out after ${timeoutMs} ms`);
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
  const maxRegions =
    Number.isInteger(requestedMax) && requestedMax > 0
      ? Math.min(requestedMax, visionImages.length)
      : visionImages.length;
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
  if (!engine && process.env.IO_INTELLIGENCE_API_KEY) {
    const ocrHint = selectedIndexes
      .map((index) => candidates[index])
      .filter((candidate) => candidate && candidate.confidence >= 25 && candidate.text)
      .map((candidate) => candidate.text)
      .join("\n");
    const result = parseVisionResponse(
      await runIoVision(
        selectedIndexes.map((index) => visionImages[index]),
        caption,
        ocrHint
      ),
      "io.net vision"
    );
    const modelName = process.env.IMAGE_SPAM_REMOTE_MODEL || DEFAULT_IO_MODEL;
    return {
      ...result,
      model: `${modelName} (io.net)`,
      index: selectedIndexes[0],
      regionsAnalyzed: selectedIndexes.length,
      regionsAvailable: visionImages.length,
    };
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
  if (process.env.IO_INTELLIGENCE_API_KEY) {
    return process.env.IMAGE_SPAM_REMOTE_MODEL || DEFAULT_IO_MODEL;
  }
  const runtime = await getLocalVision();
  return runtime.modelId;
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
    const { ocrImages, visionImages, visual } = await prepareImage(buffer);
    const ocr = await recognizeAll(ocrImages);
    const selected = selectVisionCandidate(ocr, visionImages, caption, visual);
    // Analyze every prepared region. The full image keeps overall context, while
    // the enlarged regions make each small collage panel readable to the model.
    const vision = await analyzeVisionImages(visionImages, ocr.candidates, caption);
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
  parseVisionResponse,
  preloadVisionModel,
  prepareImage,
  recognizeAll,
  runIoVision,
  selectVisionCandidate,
};
