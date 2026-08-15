const test = require("node:test");
const assert = require("node:assert/strict");
require("module-alias/register");

const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const { model: guildModel } = require("@schemas/Guild");
const { listTasks } = require("@schemas/ScheduledTask");
const ModUtils = require("@helpers/ModUtils");

let mongo;
let nextId = 600000000000000000n;
function freshId() {
  nextId += 1n;
  return String(nextId);
}

test.before(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
});

test.after(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

async function seedSettings(overrides = {}) {
  const id = freshId();
  await guildModel.create({ _id: id, ...overrides });
  return id;
}

function fakeGuild(id) {
  const guild = {
    id,
    name: "Test Guild",
    ownerId: freshId(),
    iconURL: () => null,
    roles: { cache: new Map() },
    channels: { cache: new Map() },
    members: {
      me: null,
      unban: async () => {},
    },
    bans: { create: async () => {} },
    client: { logger: { warn: () => {}, error: () => {}, debug: () => {} } },
  };

  guild.members.me = {
    id: "bot-1",
    guild,
    permissions: { has: () => true },
    roles: { highest: { position: 1000 } },
  };

  return guild;
}

function fakeMember({ guild, id = freshId(), position = 1, roleIds = [] }) {
  const held = new Set(roleIds);
  const member = {
    id,
    guild,
    displayName: `member-${id}`,
    displayAvatarURL: () => null,
    toString: () => `<@${id}>`,
    user: { id, username: `member-${id}`, globalName: null, bot: false, send: async () => {} },
    client: guild.client,
    communicationDisabledUntilTimestamp: 0,
    roles: {
      highest: { position },
      cache: {
        has: (roleId) => held.has(roleId),
      },
      add: async (role) => held.add(role.id ?? role),
      remove: async (role) => held.delete(role.id ?? role),
    },
    send: async () => {},
    async timeout(ms, _reason) {
      this.communicationDisabledUntilTimestamp = ms === null ? 0 : Date.now() + ms;
    },
  };
  return member;
}

function addRole(guild, id, { position = 1, managed = false } = {}) {
  const role = { id, name: `role-${id}`, position, managed };
  guild.roles.cache.set(id, role);
  return role;
}

/* ------------------------------------------------------------------ hierarchy */

test("hierarchy is enforced by default: a lower-positioned issuer is refused", async () => {
  const guildId = await seedSettings({});
  const guild = fakeGuild(guildId);
  const issuer = fakeMember({ guild, position: 1 });
  const target = fakeMember({ guild, position: 5 });

  assert.equal(await ModUtils.warnTarget(issuer, target, "test"), "MEMBER_PERM");
});

test("turning respect_role_hierarchy off lets a lower-positioned issuer act, but never on the owner", async () => {
  const guildId = await seedSettings({ control_center: { moderation: { respect_role_hierarchy: false } } });
  const guild = fakeGuild(guildId);
  const issuer = fakeMember({ guild, position: 1 });
  const target = fakeMember({ guild, position: 5 });

  assert.equal(await ModUtils.warnTarget(issuer, target, "test"), true);

  const owner = fakeMember({ guild, id: guild.ownerId, position: 1 });
  assert.equal(await ModUtils.warnTarget(issuer, owner, "test"), "MEMBER_PERM", "the owner is always protected");
});

test("the bot's own hierarchy is never affected by the toggle", async () => {
  const guildId = await seedSettings({ control_center: { moderation: { respect_role_hierarchy: false } } });
  const guild = fakeGuild(guildId);
  guild.members.me.roles.highest.position = 1; // the bot outranks nobody here
  const issuer = fakeMember({ guild, position: 50 });
  const target = fakeMember({ guild, position: 5 });

  assert.equal(await ModUtils.warnTarget(issuer, target, "test"), "BOT_PERM");
});

/* ------------------------------------------------------------------- timeout */

test("TIMEOUT mode (the default) behaves exactly as a plain Discord timeout", async () => {
  const guildId = await seedSettings({});
  const guild = fakeGuild(guildId);
  const issuer = fakeMember({ guild, position: 10 });
  const target = fakeMember({ guild, position: 1 });

  assert.equal(await ModUtils.timeoutTarget(issuer, target, 60_000, "test"), true);
  assert.ok(target.communicationDisabledUntilTimestamp > Date.now());
  assert.equal(await ModUtils.timeoutTarget(issuer, target, 60_000, "test"), "ALREADY_TIMEOUT");
});

test("ROLE mode refuses cleanly when no mute role is configured", async () => {
  const guildId = await seedSettings({ control_center: { moderation: { mute_mode: "ROLE" } } });
  const guild = fakeGuild(guildId);
  const issuer = fakeMember({ guild, position: 10 });
  const target = fakeMember({ guild, position: 1 });

  assert.equal(await ModUtils.timeoutTarget(issuer, target, 60_000, "test"), "NO_MUTE_ROLE");
});

test("ROLE mode assigns the configured role instead of a native timeout, and schedules its removal", async () => {
  const guildId = await seedSettings({});
  const guild = fakeGuild(guildId);
  const muteRole = addRole(guild, freshId());
  await guildModel.updateOne(
    { _id: guildId },
    { $set: { "control_center.moderation.mute_mode": "ROLE", "control_center.moderation.mute_role": muteRole.id } }
  );

  const issuer = fakeMember({ guild, position: 10 });
  const target = fakeMember({ guild, position: 1 });

  assert.equal(await ModUtils.timeoutTarget(issuer, target, 60_000, "test"), true);
  assert.equal(target.roles.cache.has(muteRole.id), true, "the mute role was assigned");
  assert.equal(target.communicationDisabledUntilTimestamp, 0, "no native timeout was applied");

  const scheduled = await listTasks({ type: "TEMP_ROLE_REMOVE", guildId });
  assert.equal(scheduled.length, 1, "the role's expiry is durably scheduled");
});

test("BOTH mode applies the role on top of a native timeout", async () => {
  const guildId = await seedSettings({});
  const guild = fakeGuild(guildId);
  const muteRole = addRole(guild, freshId());
  await guildModel.updateOne(
    { _id: guildId },
    { $set: { "control_center.moderation.mute_mode": "BOTH", "control_center.moderation.mute_role": muteRole.id } }
  );

  const issuer = fakeMember({ guild, position: 10 });
  const target = fakeMember({ guild, position: 1 });

  assert.equal(await ModUtils.timeoutTarget(issuer, target, 60_000, "test"), true);
  assert.equal(target.roles.cache.has(muteRole.id), true);
  assert.ok(target.communicationDisabledUntilTimestamp > Date.now());
});

test("BOTH mode tops up a missing mechanism instead of refusing outright", async () => {
  const guildId = await seedSettings({});
  const guild = fakeGuild(guildId);
  const muteRole = addRole(guild, freshId());
  await guildModel.updateOne(
    { _id: guildId },
    { $set: { "control_center.moderation.mute_mode": "BOTH", "control_center.moderation.mute_role": muteRole.id } }
  );

  const issuer = fakeMember({ guild, position: 10 });
  const target = fakeMember({ guild, position: 1 });
  await target.timeout(60_000, "already timed out by something else");

  assert.equal(await ModUtils.timeoutTarget(issuer, target, 60_000, "test"), true, "the role side was still missing");
  assert.equal(target.roles.cache.has(muteRole.id), true);
});

/* ------------------------------------------------------------------ untimeout */

test("unTimeoutTarget with no active mute of any kind reports NOT_MUTED", async () => {
  const guildId = await seedSettings({});
  const guild = fakeGuild(guildId);
  const issuer = fakeMember({ guild, position: 10 });
  const target = fakeMember({ guild, position: 1 });

  assert.equal(await ModUtils.unTimeoutTarget(issuer, target, "test"), "NOT_MUTED");
});

test("unTimeoutTarget removes the role and cancels its scheduled expiry under ROLE mode", async () => {
  const guildId = await seedSettings({});
  const guild = fakeGuild(guildId);
  const muteRole = addRole(guild, freshId());
  await guildModel.updateOne(
    { _id: guildId },
    { $set: { "control_center.moderation.mute_mode": "ROLE", "control_center.moderation.mute_role": muteRole.id } }
  );

  const issuer = fakeMember({ guild, position: 10 });
  const target = fakeMember({ guild, position: 1 });
  await ModUtils.timeoutTarget(issuer, target, 60_000, "test");
  assert.equal(target.roles.cache.has(muteRole.id), true);

  assert.equal(await ModUtils.unTimeoutTarget(issuer, target, "unmuted"), true);
  assert.equal(target.roles.cache.has(muteRole.id), false);

  const stillScheduled = await listTasks({ type: "TEMP_ROLE_REMOVE", guildId });
  assert.equal(stillScheduled.length, 0, "the pending removal was cancelled along with the manual unmute");
});

/* ---------------------------------------------------------------- warn expiry */

test("warnTarget arranges for its guild's warnings to eventually expire", async () => {
  const guildId = await seedSettings({});
  const guild = fakeGuild(guildId);
  const issuer = fakeMember({ guild, position: 10 });
  const target = fakeMember({ guild, position: 1 });

  assert.equal(await ModUtils.warnTarget(issuer, target, "test"), true);

  const scheduled = await listTasks({ type: "WARNING_EXPIRY_SWEEP", guildId });
  assert.equal(scheduled.length, 1);
});
