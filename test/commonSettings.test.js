const test = require("node:test");
const assert = require("node:assert/strict");
require("module-alias/register");

const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const { model: guildModel, getSettings } = require("@schemas/Guild");
const { dateFormatter, isValidTimeZone } = require("../dashboard/services/timezone");
const { CONTROL_MODULES, buildControlPatch, findModule } = require("../dashboard/services/controlCenter");
const { requireGuildAccess } = require("../dashboard/auth/middleware");
const memberRoles = require("@src/handlers/memberRoles");
const { model: memberRolesModel } = require("@schemas/MemberRoles");
const guildMemberAdd = require("@src/events/member/guildMemberAdd");

const ROLE_ID = "100000000000000001";
const MANAGED_ROLE_ID = "100000000000000002";
const USER_ID = "200000000000000001";

/**
 * A discord.js `Collection` is a `Map` with array methods layered on top;
 * `collectRestorableRoles` calls `.filter()` on `member.roles.cache` the way
 * it would on the real thing, so a plain `Map` here throws where a real
 * Collection would not.
 */
function collectionMap(entries) {
  const map = new Map(entries);
  map.filter = (fn) => [...map.values()].filter(fn);
  return map;
}

let mongo;
let nextGuildId = 900000000000100000n;

function freshGuildId() {
  nextGuildId += 1n;
  return String(nextGuildId);
}

/**
 * A real guild settings document, seeded straight into the in-memory Mongo -
 * exactly what `getSettings` reads, so `requireGuildAccess` and
 * `guildMemberAdd` run against the genuine function, not a stand-in for it.
 */
async function seedSettings(overrides = {}) {
  const id = freshGuildId();
  await guildModel.create({ _id: id, ...overrides });
  return id;
}

test.before(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
});

test.after(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

test.beforeEach(async () => {
  await memberRolesModel.deleteMany({});
});

/* -------------------------------------------------------------------- timezone */

test("isValidTimeZone accepts a real IANA name and refuses garbage", () => {
  assert.equal(isValidTimeZone("Europe/Moscow"), true);
  assert.equal(isValidTimeZone("America/New_York"), true);
  assert.equal(isValidTimeZone("Not/AZone"), false);
  assert.equal(isValidTimeZone(""), false);
  assert.equal(isValidTimeZone(null), false);
});

test("dateFormatter falls back to UTC for anything it cannot use", () => {
  const at = new Date("2026-01-01T00:30:00.000Z");
  const utc = dateFormatter(null, "en")(at);
  assert.equal(dateFormatter("garbage", "en")(at), utc);
  assert.equal(dateFormatter(undefined, "en")(at), utc);
});

test("dateFormatter renders in the configured zone", () => {
  const at = new Date("2026-01-01T00:30:00.000Z");
  const moscow = dateFormatter("Europe/Moscow", "en")(at);
  const utc = dateFormatter(null, "en")(at);
  assert.notEqual(moscow, utc, "Moscow is three hours ahead of UTC, so the rendered clock time differs");
});

test("the timezone control field only accepts a real zone, reverting to what was already stored", () => {
  const module = findModule("common");
  const guild = { id: "1", roles: { cache: new Map() }, channels: { cache: new Map() } };

  const good = buildControlPatch(
    guild,
    { timezone: "Europe/Moscow" },
    { control_center: { common: { timezone: "UTC" } } },
    module
  );
  assert.equal(good["control_center.common.timezone"], "Europe/Moscow");

  const bad = buildControlPatch(
    guild,
    { timezone: "Not/AZone" },
    { control_center: { common: { timezone: "UTC" } } },
    module
  );
  assert.equal(bad["control_center.common.timezone"], "UTC");
});

test("timezone, admin roles, autorole-always and nickname restore are live, not staged", () => {
  const fields = CONTROL_MODULES.flatMap((module) => module.groups.flatMap((group) => group.fields));
  for (const id of ["timezone", "adminRoles", "autoroleAlways", "restoreNickname"]) {
    assert.equal(fields.find((field) => field.id === id).runtime, true, id);
  }
});

/* --------------------------------------------------------------- admin roles */

test("a role field never accepts @everyone or a managed role, even from a hand-made request", () => {
  const module = findModule("common");
  const guildId = "1";
  const guild = {
    id: guildId,
    channels: { cache: new Map() },
    roles: {
      cache: new Map([
        [ROLE_ID, { id: ROLE_ID, managed: false }],
        [MANAGED_ROLE_ID, { id: MANAGED_ROLE_ID, managed: true }],
        [guildId, { id: guildId, managed: false }],
      ]),
    },
  };

  const patch = buildControlPatch(
    guild,
    { adminRoles: [ROLE_ID, MANAGED_ROLE_ID, guildId] },
    { control_center: { common: { admin_roles: [] } } },
    module
  );

  assert.deepEqual(patch["control_center.common.admin_roles"], [ROLE_ID]);
});

function mockGuild(guildId, { memberRoleIds = [] } = {}) {
  const member = {
    id: USER_ID,
    permissions: { has: () => false },
    roles: { cache: new Map(memberRoleIds.map((id) => [id, { id }])) },
  };
  return {
    id: guildId,
    members: {
      cache: new Map(),
      fetch: async (id) => (id === USER_ID ? member : null),
    },
  };
}

/**
 * `requireGuildAccess` calls `requireAuth`, which calls its own callback
 * without the outer function awaiting it - exactly how Express expects a
 * middleware to eventually call `next()`, but not something a test can just
 * `await` the middleware call itself for. This waits for whichever actually
 * happens: `next()`, or the error response being rendered.
 */
function mockReqRes(client) {
  const rendered = [];
  const req = {
    client,
    params: { guildId: client.guilds.cache.keys().next().value },
    session: { user: { id: USER_ID } },
    isOwner: false,
    dashboardPermissions: new Set(),
  };

  let settle;
  const settled = new Promise((resolve) => {
    settle = resolve;
  });

  const res = {
    locals: { locale: "en" },
    status: () => res,
    render: (view, data) => {
      rendered.push({ view, data });
      settle({ calledNext: false });
      return res;
    },
  };

  const run = () =>
    new Promise((resolve) => {
      requireGuildAccess(req, res, () => {
        settle({ calledNext: true });
      });
      settled.then(resolve);
    });

  return { req, res, rendered, run };
}

test("a role listed under admin roles is treated as a guild manager without Manage Server", async () => {
  const guildId = await seedSettings({ control_center: { common: { admin_roles: [ROLE_ID] } } });
  const guild = mockGuild(guildId, { memberRoleIds: [ROLE_ID] });
  const client = {
    config: { OWNER_IDS: [] },
    guilds: { cache: new Map([[guildId, guild]]) },
    logger: { error: () => {} },
  };
  const { run, req } = mockReqRes(client);

  const { calledNext } = await run();

  assert.equal(calledNext, true);
  assert.equal(req.guildManager, true);
});

test("holding no admin role and no Manage Server is refused", async () => {
  const guildId = await seedSettings({ control_center: { common: { admin_roles: [ROLE_ID] } } });
  const guild = mockGuild(guildId, { memberRoleIds: [] });
  const client = {
    config: { OWNER_IDS: [] },
    guilds: { cache: new Map([[guildId, guild]]) },
    logger: { error: () => {} },
  };
  const { run, rendered } = mockReqRes(client);

  const { calledNext } = await run();

  assert.equal(calledNext, false);
  assert.equal(rendered.length, 1);
});

test("a guild page formats its dates in the guild's own configured zone", async () => {
  const guildId = await seedSettings({ control_center: { common: { timezone: "Europe/Moscow" } } });
  const guild = mockGuild(guildId);
  const client = {
    config: { OWNER_IDS: [USER_ID] },
    guilds: { cache: new Map([[guildId, guild]]) },
    logger: { error: () => {} },
  };
  const { req, res, run } = mockReqRes(client);
  req.isOwner = true;

  await run();

  const at = new Date("2026-01-01T00:30:00.000Z");
  assert.equal(res.locals.formatDate(at), dateFormatter("Europe/Moscow", "en")(at));
});

test("a freshly created guild already has a sensible default zone", async () => {
  const guildId = await seedSettings();
  const guild = mockGuild(guildId);
  const client = {
    config: { OWNER_IDS: [USER_ID] },
    guilds: { cache: new Map([[guildId, guild]]) },
    logger: { error: () => {} },
  };
  const { req, res, run } = mockReqRes(client);
  req.isOwner = true;

  await run();

  const at = new Date("2026-01-01T00:30:00.000Z");
  assert.equal(res.locals.formatDate(at), dateFormatter("Europe/Moscow", "en")(at));
});

test("a guild whose zone was cleared still formats dates, in UTC", async () => {
  const guildId = await seedSettings({ control_center: { common: { timezone: null } } });
  const guild = mockGuild(guildId);
  const client = {
    config: { OWNER_IDS: [USER_ID] },
    guilds: { cache: new Map([[guildId, guild]]) },
    logger: { error: () => {} },
  };
  const { req, res, run } = mockReqRes(client);
  req.isOwner = true;

  await run();

  const at = new Date("2026-01-01T00:30:00.000Z");
  assert.equal(res.locals.formatDate(at), dateFormatter(null, "en")(at));
});

/* -------------------------------------------------------------- restore roles */

function fakeMember({
  roleIds = [],
  botHighest = 10,
  memberPosition = 1,
  nickname = null,
  bot = false,
  guildId = "999999999999999999",
} = {}) {
  // The member's own roles are entries out of the guild's role list - the same
  // objects, position and managed-ness included, the way discord.js hands them
  // out - not a bare id, which `collectRestorableRoles` would silently drop for
  // lacking a position to compare.
  const roleObjects = roleIds.map((id) => [id, { id, position: 1, managed: false, permissions: { has: () => false } }]);
  const guild = {
    id: guildId,
    members: {
      me: {
        roles: { highest: { position: botHighest } },
        permissions: { has: () => true },
      },
    },
    roles: { cache: new Map(roleObjects) },
  };
  const roleCalls = [];
  const setNicknameCalls = [];
  return {
    id: "300000000000000001",
    user: { bot },
    guild,
    nickname,
    roles: {
      cache: collectionMap(roleObjects),
      highest: { position: memberPosition },
      add: async (ids) => roleCalls.push(ids),
    },
    roleCalls,
    setNicknameCalls,
    async setNickname(value) {
      setNicknameCalls.push(value);
      this.nickname = value;
    },
    client: { logger: { error: () => {} } },
  };
}

test("saveRoles is skipped unless role restore or nickname restore wants it", async () => {
  const member = fakeMember({ roleIds: [ROLE_ID], nickname: "Old Name" });
  assert.equal(await memberRoles.saveRoles(member, {}), null);
  assert.equal(await memberRolesModel.countDocuments({}), 0);
});

test("saveRoles stores the nickname only when nickname restore is on", async () => {
  const member = fakeMember({ roleIds: [ROLE_ID], nickname: "Old Name" });
  await memberRoles.saveRoles(member, { control_center: { common: { restore_nickname: true } } });

  const stored = await memberRolesModel.findOne({ guild_id: member.guild.id, user_id: member.id }).lean();
  assert.equal(stored.nickname, "Old Name");
});

test("saveRoles never stores a bot's snapshot", async () => {
  const member = fakeMember({ roleIds: [ROLE_ID], nickname: "Bot Name", bot: true });
  await memberRoles.saveRoles(member, { control_center: { common: { restore_nickname: true } } });
  assert.equal(await memberRolesModel.countDocuments({}), 0);
});

test("restoreMembership restores roles and nickname from one snapshot when both are enabled together", async () => {
  const guildId = "999999999999999991";
  const leaving = fakeMember({ roleIds: [ROLE_ID], nickname: "Returning Member", guildId });
  const settings = {
    restore_roles: { enabled: true, retention_days: 30, include_privileged: false },
    control_center: { common: { restore_nickname: true } },
  };
  await memberRoles.saveRoles(leaving, settings);

  const rejoining = fakeMember({ roleIds: [ROLE_ID], guildId });
  const result = await memberRoles.restoreMembership(rejoining, settings);

  assert.deepEqual(result.rolesRestored, [ROLE_ID]);
  assert.equal(result.nicknameRestored, "Returning Member");
  assert.deepEqual(rejoining.roleCalls, [[ROLE_ID]]);
  assert.deepEqual(rejoining.setNicknameCalls, ["Returning Member"]);

  // The snapshot is consumed once, for both pieces - not read away by one and
  // left invisible to the other.
  assert.equal(await memberRolesModel.countDocuments({}), 0);
});

test("restoring only the nickname does not require role restore to be on, and vice versa", async () => {
  const guildId = "999999999999999992";
  const leaving = fakeMember({ roleIds: [ROLE_ID], nickname: "Name Only", guildId });
  await memberRoles.saveRoles(leaving, { control_center: { common: { restore_nickname: true } } });

  const rejoining = fakeMember({ roleIds: [], guildId });
  const result = await memberRoles.restoreMembership(rejoining, {
    restore_roles: { enabled: false },
    control_center: { common: { restore_nickname: true } },
  });

  assert.deepEqual(result.rolesRestored, []);
  assert.equal(result.nicknameRestored, "Name Only");
});

test("restoreMembership reads nothing when neither feature is on", async () => {
  const rejoining = fakeMember({});
  rejoining.guild.members.me = null; // would throw if the function tried to touch it
  const result = await memberRoles.restoreMembership(rejoining, {
    restore_roles: { enabled: false },
    control_center: { common: { restore_nickname: false } },
  });
  assert.deepEqual(result, { rolesRestored: [], nicknameRestored: null });
});

test("restoreNickname respects role hierarchy and the ManageNicknames permission", async () => {
  const guildId = "999999999999999993";
  const leaving = fakeMember({ nickname: "Blocked", guildId });
  await memberRoles.saveRoles(leaving, { control_center: { common: { restore_nickname: true } } });
  const snapshot = await memberRolesModel.findOne({ guild_id: guildId, user_id: leaving.id }).lean();

  const tooHigh = fakeMember({ memberPosition: 99, botHighest: 10, guildId });
  assert.equal(
    await memberRoles.restoreNickname(tooHigh, { control_center: { common: { restore_nickname: true } } }, snapshot),
    null,
    "the bot cannot rename someone above it"
  );

  const noPermission = fakeMember({ guildId });
  noPermission.guild.members.me.permissions.has = () => false;
  assert.equal(
    await memberRoles.restoreNickname(
      noPermission,
      { control_center: { common: { restore_nickname: true } } },
      snapshot
    ),
    null
  );
});

/* ------------------------------------------------------------- autorole_always */

test("autorole is skipped on a rejoin whose roles were restored, unless always-assign is on", async () => {
  const autoRoleId = "400000000000000001";

  async function joinScenario({ restoreRolesFirst, autoroleAlways }) {
    const guildId = await seedSettings({
      autorole: [autoRoleId],
      restore_roles: { enabled: true, retention_days: 30 },
      control_center: { common: { autorole_always: autoroleAlways } },
    });

    const discordGuild = {
      id: guildId,
      roles: {
        cache: new Map([
          [ROLE_ID, { id: ROLE_ID, managed: false, position: 1, permissions: { has: () => false } }],
          [autoRoleId, { id: autoRoleId, managed: false, position: 1, permissions: { has: () => false } }],
        ]),
      },
      members: { me: { permissions: { has: () => true }, roles: { highest: { position: 10 } } } },
    };

    function member() {
      const roleAdds = [];
      return {
        id: "500000000000000001",
        user: { bot: false },
        guild: discordGuild,
        nickname: null,
        roles: {
          cache: collectionMap([[ROLE_ID, discordGuild.roles.cache.get(ROLE_ID)]]),
          highest: { position: 1 },
          add: async (ids) => roleAdds.push(...(Array.isArray(ids) ? ids : [ids])),
        },
        roleAdds,
        client: {
          logger: { error: () => {}, debug: () => {} },
          telemetry: { record: () => {} },
          counterUpdateQueue: [],
        },
      };
    }

    if (restoreRolesFirst) {
      const leaving = member();
      const settings = await getSettings(discordGuild);
      await memberRoles.saveRoles(leaving, settings);
    }

    const rejoining = member();
    await guildMemberAdd(rejoining.client, rejoining);
    return rejoining;
  }

  const withoutAlways = await joinScenario({ restoreRolesFirst: true, autoroleAlways: false });
  assert.ok(!withoutAlways.roleAdds.includes(autoRoleId), "autorole was skipped because roles came back");

  const withAlways = await joinScenario({ restoreRolesFirst: true, autoroleAlways: true });
  assert.ok(withAlways.roleAdds.includes(autoRoleId), "always-assign forces autorole even on a restored rejoin");

  const freshJoin = await joinScenario({ restoreRolesFirst: false, autoroleAlways: false });
  assert.ok(freshJoin.roleAdds.includes(autoRoleId), "a genuinely new member still gets autorole either way");
});
