const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const healthcheck = path.join(__dirname, "..", "slaynode", "healthcheck.js");

function runHealthcheck(health) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "slaynode-health-"));
  const healthFile = path.join(directory, "health.json");
  if (health) fs.writeFileSync(healthFile, JSON.stringify(health));
  const result = spawnSync(process.execPath, [healthcheck], {
    env: {
      ...process.env,
      SLAYNODE_HEALTH_FILE: healthFile,
      SLAYNODE_HEALTH_MAX_AGE_MS: "45000",
    },
  });
  fs.rmSync(directory, { recursive: true, force: true });
  return result.status;
}

test("SlayNode healthcheck accepts a recent control-plane heartbeat", () => {
  assert.equal(runHealthcheck({ lastConnectedAt: Date.now(), stopping: false }), 0);
});

test("SlayNode healthcheck rejects stale, stopping, and missing state", () => {
  assert.equal(runHealthcheck({ lastConnectedAt: Date.now() - 60_000, stopping: false }), 1);
  assert.equal(runHealthcheck({ lastConnectedAt: Date.now(), stopping: true }), 1);
  assert.equal(runHealthcheck(null), 1);
});
