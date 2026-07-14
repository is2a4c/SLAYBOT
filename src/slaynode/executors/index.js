const crypto = require("crypto");
const { JOB_TYPES } = require("../protocol");
const classifier = require("../../services/imageSpamClassifier");

const decode = (value) => {
  const buffer = Buffer.from(value || "", "base64");
  if (!buffer.length || buffer.length > 8 * 1024 * 1024) throw new Error("invalid image payload");
  return buffer;
};
const encodePrepared = ({ ocrImages, visual }) => ({
  ocrImages: ocrImages.map((item) => item.toString("base64")),
  visual,
});

const executors = {
  [JOB_TYPES.CANARY_SHA256]: async ({ value }) => ({
    sha256: crypto.createHash("sha256").update(String(value)).digest("hex"),
  }),
  [JOB_TYPES.IMAGE_PREPARE]: async ({ imageBase64 }) =>
    encodePrepared(await classifier.prepareImage(decode(imageBase64))),
  [JOB_TYPES.IMAGE_OCR]: async ({ imagesBase64 }) => classifier.recognizeAll((imagesBase64 || []).map(decode)),
  [JOB_TYPES.IMAGE_VISION]: async ({ imageBase64, caption }) =>
    classifier.analyzeWithVision(decode(imageBase64), String(caption || "").slice(0, 2000)),
  [JOB_TYPES.IMAGE_SPAM]: async ({ imageBase64, caption, threshold }) =>
    classifier.classifyImageBuffer({
      buffer: decode(imageBase64),
      caption: String(caption || "").slice(0, 2000),
      threshold,
      localOnly: true,
    }),
};

async function execute(type, payload) {
  const executor = executors[type];
  if (!executor) throw new Error("executor is not allowlisted");
  return executor(payload || {});
}
module.exports = { executors, execute };
