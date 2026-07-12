const sharp = require("sharp");
const path = require("path");
const { createWorker, PSM } = require("tesseract.js");

const DEFAULT_THRESHOLD = 70;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 15_000;
const MAX_PENDING_ANALYSES = 2;
const IMAGE_EXTENSIONS = /\.(?:avif|gif|jpe?g|png|webp)$/i;

let workerPromise;
let localVisionPromise;
let visionQueue = Promise.resolve();
let ocrQueue = Promise.resolve();
let pendingAnalyses = 0;

function isImageAttachment(attachment) {
  return attachment.contentType?.toLowerCase().startsWith("image/") || IMAGE_EXTENSIONS.test(attachment.name || "");
}

async function getWorker() {
  if (!workerPromise) {
    const language = require("@tesseract.js-data/eng");
    workerPromise = createWorker(language.code, 1, {
      langPath: language.langPath,
      gzip: language.gzip,
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
      const modelId = process.env.IMAGE_SPAM_VISION_MODEL || "HuggingFaceTB/SmolVLM-500M-Instruct";
      const [processor, model] = await Promise.all([
        AutoProcessor.from_pretrained(modelId),
        AutoModelForImageTextToText.from_pretrained(modelId, { dtype: "q4", device: "cpu" }),
      ]);
      return { processor, model, RawImage, modelId };
    })().catch((error) => {
      localVisionPromise = undefined;
      throw error;
    });
  }
  return localVisionPromise;
}

async function runLocalVision(buffer, caption, ocrHint = "") {
  const runtime = await getLocalVision();
  const job = visionQueue.then(async () => {
    const prompt =
      "Classify this Discord image for financial or crypto reward spam. A single fraudulent panel in a collage is enough. " +
      "Look for fake withdrawals, payment confirmations, wallets, large rewards, claim prompts, and success screens. " +
      "Normal memes, games, receipts, and legitimate finance screenshots are not spam. Be conservative. " +
      "Reply with exactly one label: IMAGE_SPAM or IMAGE_SAFE. " +
      `Caption: ${JSON.stringify(caption || "")}. ` +
      `OCR from this image region: ${JSON.stringify(ocrHint.slice(0, 600))}`;
    const messages = [{ role: "user", content: [{ type: "image" }, { type: "text", text: prompt }] }];
    const formatted = runtime.processor.tokenizer.apply_chat_template(messages, {
      add_generation_prompt: true,
      tokenize: false,
    });
    const image = await runtime.RawImage.fromBlob(new Blob([buffer], { type: "image/jpeg" }));
    const inputs = await runtime.processor(formatted, image, { do_image_splitting: false });
    const output = await runtime.model.generate({ ...inputs, max_new_tokens: 8, do_sample: false });
    return runtime.processor.tokenizer.batch_decode(output, { skip_special_tokens: true })[0] || "";
  });
  visionQueue = job.catch(() => {});
  return job;
}

function parseVisionResponse(text) {
  const label = [...text.matchAll(/\bIMAGE_(SPAM|SAFE)\b/gi)].at(-1)?.[1]?.toUpperCase();
  if (!label) throw new Error(`local vision returned no classification: ${text.slice(-500)}`);
  if (label === "SPAM") {
    return { score: 85, reasons: ["local vision detected financial reward spam"], detectedText: "" };
  }
  return { score: 10, reasons: ["local vision found no convincing spam pattern"], detectedText: "" };
}

async function analyzeWithVision(buffer, caption, engine = runLocalVision, ocrHint = "") {
  const result = parseVisionResponse(await engine(buffer, caption, ocrHint));
  return { ...result, model: process.env.IMAGE_SPAM_VISION_MODEL || "SmolVLM-500M-Instruct (q4)" };
}

async function preloadVisionModel() {
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

async function classifyImage({ url, caption = "", threshold = DEFAULT_THRESHOLD }) {
  const buffer = await downloadImage(url);
  return classifyImageBuffer({ buffer, caption, threshold });
}

async function classifyImageBuffer({ buffer, caption = "", threshold = DEFAULT_THRESHOLD }) {
  if (pendingAnalyses >= MAX_PENDING_ANALYSES) throw new Error("image classifier is busy");
  pendingAnalyses += 1;
  try {
    const { ocrImages, visionImages, visual } = await prepareImage(buffer);
    const ocr = await recognizeAll(ocrImages);
    const selected = selectVisionCandidate(ocr, visionImages, caption, visual);
    const vision = await analyzeWithVision(selected.buffer, caption, runLocalVision, selected.ocrHint);
    const result = scoreImageSpam({
      caption,
      ocrText: ocr.text,
      confidence: selected.confidence,
      visual,
    });
    const combinedReasons = [
      `region: ${selected.index === 0 ? "full image" : `tile ${selected.index}`} selected (${selected.ocrRisk}/100 OCR risk)`,
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
  parseVisionResponse,
  preloadVisionModel,
  selectVisionCandidate,
};
