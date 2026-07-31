require("module-alias/register");

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  ATOMIC_PERMISSIONS,
  ROLE_PRESETS,
  resolveEffectivePermissions,
} = require("../src/services/dashboard/permissions");
const { requireGuildPermission } = require("../dashboard/auth/middleware");

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

test("guild permission gates allow guild managers and matching staff permissions", () => {
  const middleware = requireGuildPermission("automod.edit");
  let calls = 0;

  middleware({ guildManager: true }, {}, () => {
    calls += 1;
  });
  middleware({ dashboardPermissions: new Set(["automod.edit"]) }, {}, () => {
    calls += 1;
  });

  assert.equal(calls, 2);
});

test("guild permission gates reject staff roles without the requested capability", () => {
  const middleware = requireGuildPermission("config.edit");
  let rendered;
  const req = {
    dashboardPermissions: new Set(ROLE_PRESETS.moderator),
  };
  const res = {
    locals: { t: (key) => key },
    status(code) {
      assert.equal(code, 403);
      return this;
    },
    render(view, data) {
      rendered = { view, data };
    },
  };

  middleware(req, res, () => assert.fail("permission gate must not call next"));
  assert.equal(rendered.view, "error");
  assert.equal(rendered.data.title, "errors.insufficientPermissionsTitle");
});
