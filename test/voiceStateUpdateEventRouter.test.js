const test = require("node:test");
const assert = require("node:assert/strict");
require("module-alias/register");

const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const { model: guildModel } = require("@schemas/Guild");
const { listEventLogs } = require("@schemas/EventLog");
const { routeVoiceEvent } = require("@src/events/voice/voiceStateUpdate");

let mongo;
let nextId = 200000000000000000n;
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

function fakeMember({ id, bot = false }) {
  return { id, user: { bot } };
}

function voiceState({ guild, channelId = null, member }) {
  return {
    guild,
    channelId,
    channel: channelId ? { id: channelId, name: `channel-${channelId}` } : null,
    member,
  };
}

async function entriesFor(guildId, type) {
  const [entries] = await listEventLogs({ guildId, type });
  return entries;
}

test("joining a voice channel logs VOICE_JOIN with the destination channel", async () => {
  const guildId = freshId();
  await guildModel.create({ _id: guildId });
  const guild = { id: guildId };
  const member = fakeMember({ id: freshId() });
  const channelId = freshId();

  await routeVoiceEvent(
    { logger: { error: () => {} } },
    voiceState({ guild, member }),
    voiceState({ guild, channelId, member })
  );

  const entries = await entriesFor(guildId, "VOICE_JOIN");
  assert.equal(entries.length, 1);
  assert.equal(entries[0].actor_id, member.id);
  assert.equal(entries[0].channel_id, channelId);
});

test("leaving logs VOICE_LEAVE with the channel just left", async () => {
  const guildId = freshId();
  await guildModel.create({ _id: guildId });
  const guild = { id: guildId };
  const member = fakeMember({ id: freshId() });
  const channelId = freshId();

  await routeVoiceEvent(
    { logger: { error: () => {} } },
    voiceState({ guild, channelId, member }),
    voiceState({ guild, member })
  );

  const entries = await entriesFor(guildId, "VOICE_LEAVE");
  assert.equal(entries.length, 1);
  assert.equal(entries[0].channel_id, channelId);
});

test("switching between two channels logs VOICE_MOVE, not a join or a leave", async () => {
  const guildId = freshId();
  await guildModel.create({ _id: guildId });
  const guild = { id: guildId };
  const member = fakeMember({ id: freshId() });
  const fromId = freshId();
  const toId = freshId();

  await routeVoiceEvent(
    { logger: { error: () => {} } },
    voiceState({ guild, channelId: fromId, member }),
    voiceState({ guild, channelId: toId, member })
  );

  assert.equal((await entriesFor(guildId, "VOICE_MOVE")).length, 1);
  assert.equal((await entriesFor(guildId, "VOICE_JOIN")).length, 0);
  assert.equal((await entriesFor(guildId, "VOICE_LEAVE")).length, 0);
});

test("a bot's own voice state changes are never routed", async () => {
  const guildId = freshId();
  await guildModel.create({ _id: guildId });
  const guild = { id: guildId };
  const member = fakeMember({ id: freshId(), bot: true });
  const channelId = freshId();

  await routeVoiceEvent(
    { logger: { error: () => {} } },
    voiceState({ guild, member }),
    voiceState({ guild, channelId, member })
  );

  assert.equal((await entriesFor(guildId, "VOICE_JOIN")).length, 0);
});

test("no member on either state is a no-op, not a crash", async () => {
  const guildId = freshId();
  await guildModel.create({ _id: guildId });
  const guild = { id: guildId };

  await assert.doesNotReject(
    routeVoiceEvent(
      { logger: { error: () => {} } },
      voiceState({ guild, member: null }),
      voiceState({ guild, channelId: freshId(), member: null })
    )
  );
});
