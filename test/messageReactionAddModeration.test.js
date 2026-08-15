const test = require("node:test");
const assert = require("node:assert/strict");
require("module-alias/register");

const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const { model: guildModel } = require("@schemas/Guild");

// Reaction roles, starboard and flag translation are unrelated features this
// handler also calls unconditionally - stubbed out so this file can exercise
// the reaction-blocking addition in isolation, the same way antiSpamWhitelist
// stubs out ModUtils for automod's own tests.
const handlers = require("@src/handlers");
handlers.reactionRoleHandler.handleReactionAdd = async () => {};
handlers.starboardHandler.syncStarboard = async () => {};
handlers.translationHandler.handleFlagReaction = async () => {};

delete require.cache[require.resolve("@src/events/reaction/messageReactionAdd")];
const onReactionAdd = require("@src/events/reaction/messageReactionAdd");

let mongo;
let nextId = 500000000000000000n;
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

function fakeSetup({ guildId, roleIds = [], removed = [] }) {
  const held = new Set(roleIds);
  const member = { id: "member-1", roles: { cache: { has: (id) => held.has(id) } } };
  const guild = { id: guildId, members: { cache: new Map([[member.id, member]]), fetch: async () => member } };
  const user = { id: member.id, bot: false, partial: false };
  const reaction = {
    partial: false,
    emoji: { id: null, name: "👍" },
    message: { guild, content: "hi", guild_id: guildId },
    users: { remove: async (id) => removed.push(id) },
  };
  return { client: { logger: { error: () => {} } }, reaction, user };
}

test("a muted member's reaction is removed when the server turned blocking on", async () => {
  const roleId = freshId();
  const guildId = await seedSettings({
    control_center: { moderation: { block_reactions: true, mute_mode: "ROLE", mute_role: roleId } },
  });
  const removed = [];
  const { client, reaction, user } = fakeSetup({ guildId, roleIds: [roleId], removed });

  await onReactionAdd(client, reaction, user);

  assert.deepEqual(removed, [user.id]);
});

test("an unmuted member's reaction is left alone", async () => {
  const roleId = freshId();
  const guildId = await seedSettings({
    control_center: { moderation: { block_reactions: true, mute_mode: "ROLE", mute_role: roleId } },
  });
  const removed = [];
  const { client, reaction, user } = fakeSetup({ guildId, roleIds: [], removed });

  await onReactionAdd(client, reaction, user);

  assert.deepEqual(removed, []);
});

test("a muted member keeps their reaction when the server never turned blocking on", async () => {
  const roleId = freshId();
  const guildId = await seedSettings({ control_center: { moderation: { mute_mode: "ROLE", mute_role: roleId } } });
  const removed = [];
  const { client, reaction, user } = fakeSetup({ guildId, roleIds: [roleId], removed });

  await onReactionAdd(client, reaction, user);

  assert.deepEqual(removed, []);
});
