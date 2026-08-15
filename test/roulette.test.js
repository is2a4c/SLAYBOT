const test = require("node:test");
const assert = require("node:assert/strict");
require("module-alias/register");

const { CHAMBERS, TIMEOUT_MS, rouletteEnabled, spinsChamber } = require("@src/services/fun/roulette");

test("rouletteEnabled reads the server's own switch, defaulting to off", () => {
  assert.equal(rouletteEnabled(null), false);
  assert.equal(rouletteEnabled({}), false);
  assert.equal(rouletteEnabled({ control_center: { fun: { roulette_enabled: false } } }), false);
  assert.equal(rouletteEnabled({ control_center: { fun: { roulette_enabled: true } } }), true);
});

test("spinsChamber is loaded on exactly one sixth of the wheel, at the low end", () => {
  assert.equal(
    spinsChamber(() => 0),
    true,
    "the very first slot is the loaded one"
  );
  assert.equal(
    spinsChamber(() => 1 / CHAMBERS - 0.0001),
    true,
    "just under the first boundary is still loaded"
  );
  assert.equal(
    spinsChamber(() => 1 / CHAMBERS),
    false,
    "the boundary itself belongs to the next, empty slot"
  );
  assert.equal(
    spinsChamber(() => 0.999999),
    false
  );
});

test("spinsChamber only ever consults the rng it was given", () => {
  let calls = 0;
  const rng = () => {
    calls += 1;
    return 0.5;
  };
  spinsChamber(rng);
  assert.equal(calls, 1);
});

test("TIMEOUT_MS is a real, positive duration", () => {
  assert.ok(Number.isFinite(TIMEOUT_MS));
  assert.ok(TIMEOUT_MS > 0);
});
