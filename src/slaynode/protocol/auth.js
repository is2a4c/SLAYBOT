const crypto = require("crypto");
const { stableJson } = require("./index");

function sign(secret, method, path, timestamp, nonce, body = {}) {
  return crypto
    .createHmac("sha256", secret)
    .update(`${method}\n${path}\n${timestamp}\n${nonce}\n${stableJson(body)}`)
    .digest("hex");
}

function safeEqual(a, b) {
  const left = Buffer.from(a || "", "hex");
  const right = Buffer.from(b || "", "hex");
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function verify(secret, request, maxSkewMs = 60_000) {
  const timestamp = Number(request.headers["x-slay-timestamp"]);
  const nonce = request.headers["x-slay-nonce"];
  const signature = request.headers["x-slay-signature"];
  if (!timestamp || !nonce || !signature || Math.abs(Date.now() - timestamp) > maxSkewMs) return false;
  const path = request.originalUrl || request.path;
  return safeEqual(signature, sign(secret, request.method, path, timestamp, nonce, request.body));
}

module.exports = { sign, verify };
