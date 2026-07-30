const test = require("node:test");
const assert = require("node:assert/strict");
require("module-alias/register");

const {
  DAY_MS,
  MAX_BONUS_ENTRIES,
  calculateBonusEntries,
  describeRequirements,
  evaluateEligibility,
  needsMemberData,
  normalizeRequirements,
} = require("../src/helpers/GiveawayRequirements");

const NOW = Date.parse("2026-07-30T12:00:00.000Z");
const MEMBER_ROLE = "111111111111111111";
const BOOSTER_ROLE = "222222222222222222";
const MUTED_ROLE = "333333333333333333";

const member = (overrides = {}) => ({
  roleIds: [MEMBER_ROLE],
  level: 10,
  invites: 5,
  accountCreatedAt: NOW - 400 * DAY_MS,
  joinedAt: NOW - 100 * DAY_MS,
  ...overrides,
});

test("no requirements lets everyone in", () => {
  assert.deepEqual(evaluateEligibility({ requirements: {}, member: member(), now: NOW }), {
    eligible: true,
    reasons: [],
  });
});

test("a required role gates entry", () => {
  const requirements = { allowedRoles: [BOOSTER_ROLE] };

  assert.equal(evaluateEligibility({ requirements, member: member(), now: NOW }).eligible, false);
  assert.equal(
    evaluateEligibility({ requirements, member: member({ roleIds: [MEMBER_ROLE, BOOSTER_ROLE] }), now: NOW }).eligible,
    true
  );
});

test("a blocked role wins over a required role", () => {
  const result = evaluateEligibility({
    requirements: { allowedRoles: [BOOSTER_ROLE], blockedRoles: [MUTED_ROLE] },
    member: member({ roleIds: [BOOSTER_ROLE, MUTED_ROLE] }),
    now: NOW,
  });

  assert.equal(result.eligible, false);
  assert.deepEqual(result.reasons, ["holds a blocked role"]);
});

test("level and invite thresholds are enforced", () => {
  assert.match(
    evaluateEligibility({ requirements: { minLevel: 20 }, member: member(), now: NOW }).reasons[0],
    /needs level 20/
  );
  assert.match(
    evaluateEligibility({ requirements: { minInvites: 10 }, member: member(), now: NOW }).reasons[0],
    /needs 10 invites/
  );
  assert.equal(
    evaluateEligibility({ requirements: { minLevel: 10, minInvites: 5 }, member: member(), now: NOW }).eligible,
    true
  );
});

test("account age and time on the server are enforced, and unknown timestamps fail closed", () => {
  const young = member({ accountCreatedAt: NOW - 3 * DAY_MS, joinedAt: NOW - 1 * DAY_MS });

  assert.match(
    evaluateEligibility({ requirements: { minAccountAgeDays: 30 }, member: young, now: NOW }).reasons[0],
    /account must be 30 days old/
  );
  assert.match(
    evaluateEligibility({ requirements: { minServerDays: 7 }, member: young, now: NOW }).reasons[0],
    /on the server for 7 days/
  );
  assert.equal(
    evaluateEligibility({ requirements: { minServerDays: 7 }, member: member({ joinedAt: null }), now: NOW }).eligible,
    false,
    "a member with no join date cannot prove the requirement"
  );
});

test("every failed rule is reported, not just the first", () => {
  const result = evaluateEligibility({
    requirements: { minLevel: 50, minInvites: 100, minServerDays: 365 },
    member: member(),
    now: NOW,
  });

  assert.equal(result.reasons.length, 3);
});

test("bonus entries only apply to the bonus role and are capped", () => {
  const requirements = { bonus: { roleId: BOOSTER_ROLE, entries: 3 } };

  assert.equal(calculateBonusEntries({ requirements, roleIds: [BOOSTER_ROLE] }), 3);
  assert.equal(calculateBonusEntries({ requirements, roleIds: [MEMBER_ROLE] }), 0);
  assert.equal(
    calculateBonusEntries({ requirements: { bonus: { roleId: BOOSTER_ROLE, entries: 999 } }, roleIds: [BOOSTER_ROLE] }),
    MAX_BONUS_ENTRIES
  );
  assert.equal(calculateBonusEntries({ requirements: {}, roleIds: [BOOSTER_ROLE] }), 0);
});

test("nonsense values are normalised away instead of breaking the giveaway", () => {
  const rules = normalizeRequirements({
    minLevel: -5,
    minInvites: 2.7,
    minAccountAgeDays: null,
    allowedRoles: [MEMBER_ROLE, null],
    bonus: { roleId: BOOSTER_ROLE, entries: 0 },
  });

  assert.equal(rules.minLevel, 0);
  assert.equal(rules.minInvites, 2);
  assert.equal(rules.minAccountAgeDays, 0);
  assert.deepEqual(rules.allowedRoles, [MEMBER_ROLE]);
  assert.equal(rules.bonus, null);
});

test("requirements are described for the giveaway message", () => {
  const lines = describeRequirements({
    allowedRoles: [MEMBER_ROLE],
    blockedRoles: [MUTED_ROLE],
    minLevel: 5,
    minInvites: 3,
    minAccountAgeDays: 30,
    minServerDays: 7,
    bonus: { roleId: BOOSTER_ROLE, entries: 2 },
  });

  assert.equal(lines.length, 7);
  assert.match(lines[0], new RegExp(`<@&${MEMBER_ROLE}>`));
  assert.match(lines.join("\n"), /Level 5\+/);
  assert.match(lines.join("\n"), /2x entries/);
  assert.deepEqual(describeRequirements({}), []);
});

test("only level and invite rules need a database read", () => {
  assert.equal(needsMemberData({ allowedRoles: [MEMBER_ROLE], minServerDays: 7 }), false);
  assert.equal(needsMemberData({ minLevel: 2 }), true);
  assert.equal(needsMemberData({ minInvites: 2 }), true);
});
