/**
 * Node only exposes the WebCrypto API as `globalThis.crypto` unconditionally
 * from v19 onward. A couple of third-party dependencies (serialize-javascript,
 * pulled in by discord-giveaways) reference the bare global directly and
 * throw "crypto is not defined" the moment they load without it.
 *
 * The project now targets Node 24+, where this is always a no-op - kept as a
 * cheap safety net for any host that has not yet been upgraded to it, since
 * this loads unconditionally at boot (BotClient requires the giveaway
 * handler at module scope) and a missing global here would crash startup
 * outright, not just the giveaway feature.
 *
 * Call this before anything that might require those packages.
 */
module.exports = function polyfillGlobalCrypto() {
  if (typeof globalThis.crypto === "undefined") {
    globalThis.crypto = require("node:crypto").webcrypto;
  }
};
