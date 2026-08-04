const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const loadEnvironment = require("../src/helpers/loadEnvironment");

const KEYS = ["SLAYBOT_TEST_SECRET", "SLAYBOT_TEST_PRESET", "SLAYBOT_TEST_BLANK"];

function withEnvironment(file, run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "slaybot-env-"));
  const saved = KEYS.map((key) => [key, process.env[key]]);
  fs.writeFileSync(path.join(directory, ".env"), file);
  try {
    return run(directory);
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test("an exported empty variable loses to the real value in .env", () => {
  const secret = "k".repeat(64);
  withEnvironment(`SLAYBOT_TEST_SECRET=${secret}\nSLAYBOT_TEST_BLANK=\n`, (directory) => {
    // What a deploy leaves behind when its secret store has no value to send.
    process.env.SLAYBOT_TEST_SECRET = "";
    process.env.SLAYBOT_TEST_BLANK = "";

    loadEnvironment(directory);

    assert.equal(process.env.SLAYBOT_TEST_SECRET, secret);
    // .env is empty here too, so there is nothing better to fall back to.
    assert.equal(process.env.SLAYBOT_TEST_BLANK, "");
  });
});

test("a variable that already carries a value still wins over .env", () => {
  withEnvironment("SLAYBOT_TEST_PRESET=from-file\n", (directory) => {
    process.env.SLAYBOT_TEST_PRESET = "from-environment";

    loadEnvironment(directory);

    assert.equal(process.env.SLAYBOT_TEST_PRESET, "from-environment");
  });
});

test("a missing .env is not an error", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "slaybot-env-"));
  try {
    assert.doesNotThrow(() => loadEnvironment(directory));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
