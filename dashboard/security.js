// Deliberately not the same CSP as src/web/smart-invites/security.js: that one
// assumes fully inline, script-less static pages (default-src 'none'), which
// would block this app's own same-origin /style.css and /dashboard.js. The rate
// limiter from smart-invites is still reused as-is (see dashboard/app.js).
function applyDashboardSecurityHeaders(_req, res, next) {
  res.set({
    "Content-Security-Policy":
      "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; " +
      "img-src 'self' https://cdn.discordapp.com data:; form-action 'self'; " +
      "base-uri 'none'; frame-ancestors 'none'; object-src 'none'",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Cache-Control": "no-store",
  });
  next();
}

module.exports = { applyDashboardSecurityHeaders };
