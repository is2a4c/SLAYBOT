const crypto = require("crypto");

function applySecurityHeaders(_req, res, next) {
  res.set({
    "Content-Security-Policy":
      "default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Cache-Control": "no-store",
  });
  next();
}

function createRateLimiter({ windowMs, max }) {
  const salt = crypto.randomBytes(32);
  const buckets = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const key = crypto
      .createHmac("sha256", salt)
      .update(String(req.ip || req.socket?.remoteAddress || "unknown"))
      .digest("base64url");
    const current = buckets.get(key);
    if (!current || current.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    current.count += 1;
    if (current.count > max) {
      res.set("Retry-After", String(Math.ceil((current.resetAt - now) / 1000)));
      return res.status(429).type("text/plain").send("Слишком много запросов. Попробуйте позже.");
    }
    if (buckets.size > 10000) {
      for (const [bucketKey, value] of buckets) {
        if (value.resetAt <= now) buckets.delete(bucketKey);
      }
    }
    return next();
  };
}

module.exports = {
  applySecurityHeaders,
  createRateLimiter,
};
