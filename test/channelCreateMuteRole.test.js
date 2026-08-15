const test = require("node:test");
const assert = require("node:assert/strict");
require("module-alias/register");

const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const { ChannelType } = require("discord.js");

const { model: guildModel } = require("@schemas/Guild");
const onChannelCreate = require("@src/events/channel/channelCreate");

let mongo;
let nextId = 400000000000000000n;
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
    roles: { cache: new Map() },
    channels: { cache: new Map() },
    client: { logger: { warn: () => {}, error: () => {} } },
    fetchAuditLogs: async () => {
      throw new Error("no audit log access in this fixture");
    },
  };
  return guild;
}

function fakeChannel({ id, guild, type = ChannelType.GuildText }) {
  const overwrites = {
    cache: new Map(),
    edits: [],
    async edit(role, patch) {
      this.edits.push({ roleId: role.id, patch });
    },
  };
  return {
    id,
    guild,
    type,
    name: `channel-${id}`,
    permissionOverwrites: overwrites,
    isThread: () => false,
    isTextBased: () => type === ChannelType.GuildText,
  };
}

test("a fresh channel gets the mute role's deny overwrite when the server is already using a role mute", async () => {
  const guildId = await seedSettings({});
  const guild = fakeGuild(guildId);
  const roleId = freshId();
  guild.roles.cache.set(roleId, { id: roleId });
  await guildModel.updateOne(
    { _id: guildId },
    { $set: { "control_center.moderation.mute_mode": "ROLE", "control_center.moderation.mute_role": roleId } }
  );

  const channel = fakeChannel({ id: freshId(), guild });
  await onChannelCreate({ logger: { warn: () => {}, error: () => {} } }, channel);

  assert.equal(channel.permissionOverwrites.edits.length, 1);
});

test("a fresh channel is left alone when the server is not using a role mute", async () => {
  const guildId = await seedSettings({});
  const guild = fakeGuild(guildId);
  const channel = fakeChannel({ id: freshId(), guild });

  await onChannelCreate({ logger: { warn: () => {}, error: () => {} } }, channel);

  assert.equal(channel.permissionOverwrites.edits.length, 0);
});

test("a role mute mode with a role that no longer exists does not throw", async () => {
  const guildId = await seedSettings({});
  const guild = fakeGuild(guildId);
  await guildModel.updateOne(
    { _id: guildId },
    { $set: { "control_center.moderation.mute_mode": "ROLE", "control_center.moderation.mute_role": freshId() } }
  );
  const channel = fakeChannel({ id: freshId(), guild });

  await assert.doesNotReject(onChannelCreate({ logger: { warn: () => {}, error: () => {} } }, channel));
  assert.equal(channel.permissionOverwrites.edits.length, 0);
});

test("a DM or otherwise guild-less channel is ignored", async () => {
  await assert.doesNotReject(
    onChannelCreate({ logger: { warn: () => {}, error: () => {} } }, { id: "x", guild: null })
  );
});
