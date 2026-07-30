const crypto = require("crypto");

const STATE_TTL_MS = 5 * 60 * 1000;
const ALLOWED_REDIRECT_SUFFIXES = ["/g/", "/owner"];

/**
 * Only relative paths under this app's own mount (basePath) with a known
 * suffix are allowed as a post-login redirect target. Anything else (absolute
 * URLs, protocol-relative `//host`, paths outside basePath) falls back to
 * `${basePath}/`.
 * @param {string} path
 * @param {string} basePath - e.g. "/dashboard", as seen in res.locals.basePath
 */
function sanitizeRedirectPath(path, basePath = "") {
  const root = `${basePath}/`;
  if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//")) return root;
  if (path === root || path === basePath) return root;
  if (ALLOWED_REDIRECT_SUFFIXES.some((suffix) => path.startsWith(`${basePath}${suffix}`))) return path;
  return root;
}

/**
 * Creates a single-use OAuth state token bound to this session and stores the
 * (sanitized) redirect target alongside it so the callback never has to trust
 * a client-supplied redirect at exchange time.
 * @param {import('express').Request} req
 * @param {string} redirectTo
 * @param {string} basePath
 */
function createState(req, redirectTo, basePath = "") {
  const value = crypto.randomBytes(24).toString("base64url");
  req.session.oauthState = {
    value,
    redirectTo: sanitizeRedirectPath(redirectTo, basePath),
    expiresAt: Date.now() + STATE_TTL_MS,
  };
  return value;
}

/**
 * Verifies and consumes the state token. Returns the sanitized redirect path on
 * success, or null if the token is missing, expired, or does not match.
 * @param {import('express').Request} req
 * @param {string} submittedValue
 */
function consumeState(req, submittedValue) {
  const record = req.session.oauthState;
  req.session.oauthState = null;
  if (!record || record.expiresAt < Date.now()) return null;
  if (typeof submittedValue !== "string" || submittedValue.length !== record.value.length) return null;
  const match = crypto.timingSafeEqual(Buffer.from(submittedValue), Buffer.from(record.value));
  return match ? record.redirectTo : null;
}

module.exports = { createState, consumeState, sanitizeRedirectPath, STATE_TTL_MS };
