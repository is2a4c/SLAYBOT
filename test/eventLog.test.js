const test = require("node:test");
const assert = require("node:assert/strict");
require("module-alias/register");

const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const { createEventLog, listEventLogs, deleteGuildEventLogs } = require("@schemas/EventLog");

let mongo;
let nextId = 300000000000000000n;
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

test("listEventLogs filters by type, member (actor or target), and channel independently", async () => {
  const guildId = freshId();
  const actorId = freshId();
  const targetId = freshId();
  const bystanderId = freshId();
  const channelId = freshId();
  const otherChannelId = freshId();

  await createEventLog({ guild_id: guildId, type: "WARN", actor_id: actorId, target_id: targetId, channel_id: null });
  await createEventLog({
    guild_id: guildId,
    type: "KICK",
    actor_id: bystanderId,
    target_id: bystanderId,
    channel_id: channelId,
  });
  await createEventLog({
    guild_id: guildId,
    type: "CHANNEL_CREATE",
    actor_id: actorId,
    channel_id: otherChannelId,
  });

  const [byType] = await listEventLogs({ guildId, type: "KICK" });
  assert.equal(byType.length, 1);
  assert.equal(byType[0].type, "KICK");

  const [byActor] = await listEventLogs({ guildId, memberId: actorId });
  assert.equal(byActor.length, 2, "matches as either actor or target");

  const [byTarget] = await listEventLogs({ guildId, memberId: targetId });
  assert.equal(byTarget.length, 1);
  assert.equal(byTarget[0].type, "WARN");

  const [byChannel] = await listEventLogs({ guildId, channelId });
  assert.equal(byChannel.length, 1);
  assert.equal(byChannel[0].type, "KICK");

  const [combined] = await listEventLogs({ guildId, memberId: actorId, channelId: otherChannelId });
  assert.equal(combined.length, 1);
  assert.equal(combined[0].type, "CHANNEL_CREATE");
});

test("listEventLogs paginates newest first and reports the true total", async () => {
  const guildId = freshId();
  for (let i = 0; i < 5; i += 1) {
    await createEventLog({ guild_id: guildId, type: "BAN", actor_id: freshId(), target_id: freshId() });
  }

  const [page1, total1] = await listEventLogs({ guildId, page: 1, pageSize: 2 });
  const [page2] = await listEventLogs({ guildId, page: 2, pageSize: 2 });

  assert.equal(page1.length, 2);
  assert.equal(page2.length, 2);
  assert.equal(total1, 5);
  assert.notEqual(page1[0]._id.toString(), page2[0]._id.toString());
});

test("deleteGuildEventLogs clears only the given guild", async () => {
  const guildId = freshId();
  const otherGuildId = freshId();
  await createEventLog({ guild_id: guildId, type: "BAN", actor_id: freshId() });
  await createEventLog({ guild_id: otherGuildId, type: "BAN", actor_id: freshId() });

  await deleteGuildEventLogs(guildId);

  const [, totalHere] = await listEventLogs({ guildId });
  const [, totalOther] = await listEventLogs({ guildId: otherGuildId });
  assert.equal(totalHere, 0);
  assert.equal(totalOther, 1);
});
