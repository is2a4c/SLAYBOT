const test = require("node:test");
const assert = require("node:assert/strict");
require("module-alias/register");

const polyfillGlobalCrypto = require("@helpers/polyfillGlobalCrypto");

// `globalThis.crypto` is Node's own lazily-initialised, non-writable getter,
// so a plain assignment silently no-ops - it has to be redefined and, after
// each test, restored the same way.
function withGlobalCrypto(value, fn) {
  const original = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  if (value === undefined) delete globalThis.crypto;
  else Object.defineProperty(globalThis, "crypto", { value, configurable: true, writable: true });

  try {
    fn();
  } finally {
    if (original) Object.defineProperty(globalThis, "crypto", original);
    else delete globalThis.crypto;
  }
}

test("leaves a real crypto global alone", () => {
  const marker = {};
  withGlobalCrypto(marker, () => {
    polyfillGlobalCrypto();
    assert.equal(globalThis.crypto, marker, "an existing global is never replaced");
  });
});

test("fills in a working WebCrypto object when the global is missing", () => {
  withGlobalCrypto(undefined, () => {
    polyfillGlobalCrypto();
    assert.equal(typeof globalThis.crypto, "object");
    assert.equal(typeof globalThis.crypto.getRandomValues, "function");
    assert.ok(globalThis.crypto.getRandomValues(new Uint8Array(4)) instanceof Uint8Array);
  });
});
