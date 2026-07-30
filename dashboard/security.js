// Deliberately not the same CSP as src/web/smart-invites/security.js: that one
// assumes fully inline, script-less static pages (default-src 'none'), which
// would block this app's own same-origin /style.css and /dashboard.js. The rate
// limiter from smart-invites is still reused as-is (see dashboard/app.js).
function applyDashboardSecurityHeaders(_req, res, next) {
  res.set({
    // form-action allows discord.com because /auth/login navigates there for
    // OAuth (a plain 302, not an actual <form> - but WebKit/Safari enforces
    // form-action against that redirect target too, more aggressively than
    // the spec's form-submission-only wording, so 'self' alone 404s the login
    // button on Safari).
    "Content-Security-Policy":
      "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; " +
      "img-src 'self' https://cdn.discordapp.com data:; form-action 'self' https://discord.com; " +
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
