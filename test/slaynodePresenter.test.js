const test = require("node:test");
const assert = require("node:assert/strict");
const presenter = require("../src/slaynode/control/presenter");
const { WEIGHTS, tierForScore, DEFAULT_TIERS } = require("../src/slaynode/control/partner");

test("credits render as whole, separated numbers", () => {
  assert.equal(presenter.formatCredits(0), "0");
  assert.equal(presenter.formatCredits(101), "101");
  assert.equal(presenter.formatCredits(1234567), "1,234,567");
  assert.equal(presenter.formatCredits(undefined), "0");
});

test("progress bar clamps and reports percent", () => {
  assert.equal(presenter.progressBar(0, 10), "░░░░░░░░░░ 0%");
  assert.equal(presenter.progressBar(1, 10), "██████████ 100%");
  assert.equal(presenter.progressBar(-5, 10), "░░░░░░░░░░ 0%");
  assert.equal(presenter.progressBar(2, 10), "██████████ 100%");
  assert.match(presenter.progressBar(0.5, 10), /█{5}░{5} 50%/);
});

test("tier and status metadata resolve with safe fallbacks", () => {
  assert.equal(presenter.tierMeta("Gold").emoji, "🥇");
  assert.equal(presenter.tierMeta("Nonexistent").emoji, presenter.tierMeta("Bronze").emoji);
  assert.equal(presenter.statusEmoji("ONLINE"), "🟢");
  assert.equal(presenter.statusEmoji("REVOKED"), "⛔");
  assert.equal(presenter.statusEmoji("???"), "⚪");
});

test("nextTier walks the ladder and stops at the top", () => {
  assert.equal(presenter.nextTier("Bronze", DEFAULT_TIERS).name, "Silver");
  assert.equal(presenter.nextTier("Gold", DEFAULT_TIERS).name, "Platinum");
  assert.equal(presenter.nextTier("Platinum", DEFAULT_TIERS), null);
});

test("tierProgress reports remaining points and maxes out", () => {
  const bronze = presenter.tierProgress(20, "Bronze", DEFAULT_TIERS);
  assert.equal(bronze.maxed, false);
  assert.equal(bronze.next, "Silver");
  assert.equal(bronze.pointsToNext, 35); // Silver threshold 55 - score 20
  const platinum = presenter.tierProgress(95, "Platinum", DEFAULT_TIERS);
  assert.equal(platinum.maxed, true);
  assert.equal(platinum.next, null);
});

test("relativeTime buckets a timestamp", () => {
  const now = Date.now();
  assert.equal(presenter.relativeTime(null, now), "never");
  assert.equal(presenter.relativeTime(new Date(now - 2_000), now), "just now");
  assert.equal(presenter.relativeTime(new Date(now - 90_000), now), "1m ago");
  assert.equal(presenter.relativeTime(new Date(now - 3 * 3600_000), now), "3h ago");
  assert.equal(presenter.relativeTime(new Date(now - 2 * 86400_000), now), "2d ago");
});

test("fleetSummary counts online, capacity and gpu", () => {
  const summary = presenter.fleetSummary([
    { status: "ONLINE", resources: { parallelism: 2, gpu: true } },
    { status: "OFFLINE", limits: { parallelism: 4 } },
    { status: "ONLINE" },
  ]);
  assert.deepEqual(summary, { total: 3, online: 2, capacity: 7, gpu: 1 });
});

test("nodeLine is compact and includes credits", () => {
  const now = Date.now();
  const line = presenter.nodeLine(
    {
      name: "Alpha",
      status: "ONLINE",
      reliability: 0.987,
      load: { running: 1 },
      limits: { parallelism: 4 },
      latencyMs: 42,
      lastHeartbeatAt: new Date(now - 5_000),
    },
    1500,
    now
  );
  assert.match(line, /🟢 \*\*Alpha\*\*/);
  assert.match(line, /99% rel/);
  assert.match(line, /1\/4 load/);
  assert.match(line, /1,500 cr/);
});

test("scoring weights are a normalized blend and thresholds map to tiers", () => {
  const sum = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9);
  assert.equal(tierForScore(0), "Bronze");
  assert.equal(tierForScore(60), "Silver");
  assert.equal(tierForScore(80), "Gold");
  assert.equal(tierForScore(95), "Platinum");
});
