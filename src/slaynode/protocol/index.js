const crypto = require("crypto");

const PROTOCOL_VERSION = "1.0";
const PRIVACY = Object.freeze({
  PUBLIC: "PUBLIC",
  ANONYMIZED: "ANONYMIZED",
  GUILD_PRIVATE: "GUILD_PRIVATE",
  CENTRAL_ONLY: "CENTRAL_ONLY",
});
const JOB_TYPES = Object.freeze({
  IMAGE_PREPARE: "image.prepare.v1",
  IMAGE_OCR: "image.ocr.v1",
  IMAGE_VISION: "image.vision.v1",
  IMAGE_SPAM: "image.spam.v1",
  CANARY_SHA256: "canary.sha256.v1",
});
const DISTRIBUTABLE_TYPES = new Set(Object.values(JOB_TYPES));

function stableJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
    .join(",")}}`;
}

function digest(value) {
  return crypto
    .createHash("sha256")
    .update(Buffer.isBuffer(value) ? value : stableJson(value))
    .digest("hex");
}

function validateJob(input, maxBytes = 8 * 1024 * 1024) {
  if (!input || input.protocolVersion !== PROTOCOL_VERSION) throw new Error("unsupported protocol version");
  if (!DISTRIBUTABLE_TYPES.has(input.type)) throw new Error("unsupported executor");
  if (!Object.values(PRIVACY).includes(input.privacyClass)) throw new Error("invalid privacy class");
  if (input.privacyClass === PRIVACY.CENTRAL_ONLY) throw new Error("CENTRAL_ONLY jobs cannot be distributed");
  if (Buffer.byteLength(stableJson(input.payload || {})) > maxBytes) throw new Error("payload too large");
  return input;
}

module.exports = { PROTOCOL_VERSION, PRIVACY, JOB_TYPES, DISTRIBUTABLE_TYPES, stableJson, digest, validateJob };
