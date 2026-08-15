/**
 * Node only exposes the WebCrypto API as `globalThis.crypto` unconditionally
 * from v19 onward; on v18 (this project's declared floor) it is absent unless
 * the process was started with `--experimental-global-webcrypto`. A couple of
 * third-party dependencies (serialize-javascript, pulled in by
 * discord-giveaways) reference the bare global directly and throw
 * "crypto is not defined" the moment they load without it.
 *
 * Call this before anything that might require those packages.
 */
module.exports = function polyfillGlobalCrypto() {
  if (typeof globalThis.crypto === "undefined") {
    globalThis.crypto = require("node:crypto").webcrypto;
  }
};
