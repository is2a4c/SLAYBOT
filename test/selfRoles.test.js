const test = require("node:test");
const assert = require("node:assert/strict");
require("module-alias/register");

const { resolveRoleChanges, resolveComponentEmoji, SelfRoleError } = require("../src/helpers/SelfRoles");

const RED = "111111111111111111";
const BLUE = "222222222222222222";
const GREEN = "333333333333333333";

const panel = (overrides = {}) => ({
  style: "BUTTON",
  unique: false,
  max_roles: 0,
  allow_remove: true,
  roles: [{ role_id: RED }, { role_id: BLUE }, { role_id: GREEN }],
  ...overrides,
});

test("button panels toggle the clicked role", () => {
  assert.deepEqual(resolveRoleChanges({ panel: panel(), memberRoleIds: [], selected: [RED] }), {
    add: [RED],
    remove: [],
    error: null,
  });

  assert.deepEqual(resolveRoleChanges({ panel: panel(), memberRoleIds: [RED], selected: [RED] }), {
    add: [],
    remove: [RED],
    error: null,
  });
});

test("unique panels swap the held role instead of stacking", () => {
  const result = resolveRoleChanges({
    panel: panel({ unique: true }),
    memberRoleIds: [BLUE, "999999999999999999"],
    selected: [RED],
  });

  assert.deepEqual(result.add, [RED]);
  assert.deepEqual(result.remove, [BLUE]);
});

test("max_roles caps how many panel roles a member can hold", () => {
  const result = resolveRoleChanges({
    panel: panel({ max_roles: 2 }),
    memberRoleIds: [RED, BLUE],
    selected: [GREEN],
  });

  assert.deepEqual(result.add, []);
  assert.match(result.error, /only hold 2 roles/);
});

test("add-only panels refuse to take a role back", () => {
  const result = resolveRoleChanges({
    panel: panel({ allow_remove: false }),
    memberRoleIds: [RED],
    selected: [RED],
  });

  assert.match(result.error, /cannot be removed/);
});

test("dropdown panels reconcile the whole selection", () => {
  const result = resolveRoleChanges({
    panel: panel({ style: "SELECT" }),
    memberRoleIds: [RED, GREEN],
    selected: [RED, BLUE],
  });

  assert.deepEqual(result.add, [BLUE]);
  assert.deepEqual(result.remove, [GREEN]);
});

test("dropdown panels keep roles when removal is disabled", () => {
  const result = resolveRoleChanges({
    panel: panel({ style: "SELECT", allow_remove: false }),
    memberRoleIds: [RED],
    selected: [BLUE],
  });

  assert.deepEqual(result.add, [BLUE]);
  assert.deepEqual(result.remove, []);
});

test("roles that left the panel are rejected", () => {
  const result = resolveRoleChanges({
    panel: panel(),
    memberRoleIds: [],
    selected: ["444444444444444444"],
  });

  assert.match(result.error, /no longer part of this panel/);
});

test("emoji input is validated against the guild", () => {
  const guild = { emojis: { cache: new Map([["345678901234567890", {}]]) } };

  assert.equal(resolveComponentEmoji("🎮", guild), "🎮");
  assert.equal(resolveComponentEmoji("<:vip:345678901234567890>", guild), "<:vip:345678901234567890>");
  assert.equal(resolveComponentEmoji(null, guild), null);
  assert.throws(() => resolveComponentEmoji("<:nope:456789012345678901>", guild), SelfRoleError);
  assert.throws(() => resolveComponentEmoji("not-an-emoji", guild), SelfRoleError);
});
