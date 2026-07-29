const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

test("SlayNode installer enrolls once, protects credentials, and supports updates", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "slaynode-installer-"));
  const bin = path.join(root, "bin");
  const install = path.join(root, "worker");
  const calls = path.join(root, "docker-calls.log");
  fs.mkdirSync(bin);
  const docker = path.join(bin, "docker");
  fs.writeFileSync(
    docker,
    `#!/bin/sh
printf '%s\\n' "$*" >> "$FAKE_DOCKER_CALLS"
case "$*" in
  "compose version"|"info"|"build "*) exit 0 ;;
  *"run --rm --no-deps enroll"*)
    printf '%s\\n' '{"nodeId": "test-node", "secret": "test-secret", "protocolVersion": "1.0"}'
    exit 0
    ;;
  *"up -d slaynode"*) exit 0 ;;
  *"ps -q slaynode"*) printf '%s\\n' 'test-container'; exit 0 ;;
  "inspect "*) printf '%s\\n' 'healthy'; exit 0 ;;
esac
exit 1
`
  );
  fs.chmodSync(docker, 0o755);

  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    FAKE_DOCKER_CALLS: calls,
    SLAYNODE_SOURCE_DIR: path.join(__dirname, ".."),
    SLAYNODE_INSTALL_DIR: install,
    SLAYNODE_CONTROL_URL: "https://control.example",
    SLAYNODE_ENROLLMENT_TOKEN: "one-time-token",
  };
  const script = path.join(__dirname, "..", "scripts", "install-slaynode.sh");
  const first = spawnSync("bash", [script], { env, encoding: "utf8" });
  assert.equal(first.status, 0, first.stderr);

  const credentials = fs.readFileSync(path.join(install, ".env"), "utf8");
  assert.match(credentials, /^SLAYNODE_ID=test-node$/m);
  assert.match(credentials, /^SLAYNODE_SECRET=test-secret$/m);
  assert.doesNotMatch(credentials, /one-time-token/);
  assert.equal(fs.statSync(path.join(install, ".env")).mode & 0o777, 0o600);
  assert.equal(fs.existsSync(path.join(install, ".enroll.env")), false);

  const second = spawnSync("bash", [script], {
    env: { ...env, SLAYNODE_ENROLLMENT_TOKEN: "" },
    encoding: "utf8",
  });
  assert.equal(second.status, 0, second.stderr);
  const enrollmentRuns = fs
    .readFileSync(calls, "utf8")
    .split("\n")
    .filter((line) => line.includes("run --rm --no-deps enroll"));
  assert.equal(enrollmentRuns.length, 1);

  fs.rmSync(root, { recursive: true, force: true });
});
