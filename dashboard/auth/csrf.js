const crypto = require("crypto");

function ensureCsrfToken(req) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(24).toString("base64url");
  }
  return req.session.csrfToken;
}

function verifyCsrfToken(req) {
  const submitted = req.body?._csrf;
  const expected = req.session?.csrfToken;
  if (typeof submitted !== "string" || typeof expected !== "string" || submitted.length !== expected.length) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(submitted), Buffer.from(expected));
}

function requireCsrf(req, res, next) {
  if (verifyCsrfToken(req)) return next();
  return res.status(403).render("error", {
    title: res.locals.t("errors.csrfTitle"),
    message: res.locals.t("errors.csrfMessage"),
  });
}

module.exports = { ensureCsrfToken, verifyCsrfToken, requireCsrf };
