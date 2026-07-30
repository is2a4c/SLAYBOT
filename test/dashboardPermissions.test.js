require("module-alias/register");

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  ATOMIC_PERMISSIONS,
  ROLE_PRESETS,
  resolveEffectivePermissions,
} = require("../src/services/dashboard/permissions");

test("owner override grants every atomic permission regardless of staff account", () => {
  const effective = resolveEffectivePermissions({ isOwner: true, staffAccount: null });
  for (const permission of ATOMIC_PERMISSIONS) {
    assert.ok(effective.has(permission), `owner should have ${permission}`);
  }
});

test("a user with no staff account and no owner override has no permissions", () => {
  const effective = resolveEffectivePermissions({ isOwner: false, staffAccount: null });
  assert.equal(effective.size, 0);
});

test("moderator role grants only its preset, not admin-only permissions", () => {
  const effective = resolveEffectivePermissions({ isOwner: false, staffAccount: { role: "moderator" } });
  for (const permission of ROLE_PRESETS.moderator) {
    assert.ok(effective.has(permission));
  }
  assert.equal(effective.has("staff.manage"), false);
  assert.equal(effective.has("smartinvites.manage"), false);
});

test("admin role grants every atomic permission", () => {
  const effective = resolveEffectivePermissions({ isOwner: false, staffAccount: { role: "admin" } });
  for (const permission of ATOMIC_PERMISSIONS) {
    assert.ok(effective.has(permission));
  }
});

test("an unknown role on a staff account resolves to no permissions instead of throwing", () => {
  const effective = resolveEffectivePermissions({ isOwner: false, staffAccount: { role: "not-a-real-role" } });
  assert.equal(effective.size, 0);
});
