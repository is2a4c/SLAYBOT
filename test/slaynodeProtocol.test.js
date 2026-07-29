const test = require("node:test");
const assert = require("node:assert/strict");
const { PROTOCOL_VERSION, PRIVACY, JOB_TYPES, validateJob, digest } = require("../src/slaynode/protocol");
const { sign, verify } = require("../src/slaynode/protocol/auth");

test("protocol rejects central-only and arbitrary executors", () => {
  assert.throws(
    () =>
      validateJob({
        protocolVersion: PROTOCOL_VERSION,
        type: JOB_TYPES.IMAGE_OCR,
        privacyClass: PRIVACY.CENTRAL_ONLY,
        payload: {},
      }),
    /CENTRAL_ONLY/
  );
  assert.throws(
    () =>
      validateJob({ protocolVersion: PROTOCOL_VERSION, type: "shell.exec", privacyClass: PRIVACY.PUBLIC, payload: {} }),
    /unsupported executor/
  );
});

test("protocol enforces payload limits and stable digests", () => {
  assert.throws(
    () =>
      validateJob(
        {
          protocolVersion: PROTOCOL_VERSION,
          type: JOB_TYPES.CANARY_SHA256,
          privacyClass: PRIVACY.PUBLIC,
          payload: { value: "too large" },
        },
        2
      ),
    /payload too large/
  );
  assert.equal(digest({ b: 2, a: 1 }), digest({ a: 1, b: 2 }));
});

test("signed requests bind method, path, body, time and nonce", () => {
  const secret = "test-secret";
  const timestamp = Date.now();
  const nonce = "unique";
  const body = { load: 1 };
  const request = {
    method: "POST",
    path: "/v1/node/heartbeat",
    body,
    headers: {
      "x-slay-timestamp": String(timestamp),
      "x-slay-nonce": nonce,
      "x-slay-signature": sign(secret, "POST", "/v1/node/heartbeat", timestamp, nonce, body),
    },
  };
  assert.equal(verify(secret, request), true);
  request.body = { load: 2 };
  assert.equal(verify(secret, request), false);
});
