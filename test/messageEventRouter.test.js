const test = require("node:test");
const assert = require("node:assert/strict");
require("module-alias/register");

const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const { model: guildModel } = require("@schemas/Guild");
const { listEventLogs } = require("@schemas/EventLog");
const onMessageDelete = require("@src/events/message/messageDelete");
const onMessageUpdate = require("@src/events/message/messageUpdate");

let mongo;
let nextId = 800000000000000000n;
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

async function entriesFor(guildId, type) {
  const [entries] = await listEventLogs({ guildId, type });
  return entries;
}

function fakeGuild(id) {
  return { id, channels: { cache: new Map() } };
}

function fakeClient() {
  return { logger: { error: () => {}, warn: () => {} } };
}

/* ------------------------------------------------------------ messageDelete */

test("deleting a real member message logs MESSAGE_DELETE with a content preview", async () => {
  const guildId = freshId();
  await guildModel.create({ _id: guildId });
  const guild = fakeGuild(guildId);
  const channelId = freshId();

  const message = {
    partial: false,
    guild,
    guildId,
    channelId,
    content: "this message will be deleted",
    author: { id: freshId(), bot: false },
  };

  await onMessageDelete(fakeClient(), message);

  const entries = await entriesFor(guildId, "MESSAGE_DELETE");
  assert.equal(entries.length, 1);
  assert.equal(entries[0].channel_id, channelId);
  assert.match(entries[0].detail, /this message will be deleted/);
});

test("a partial message (content unknown) is not logged", async () => {
  const guildId = freshId();
  await guildModel.create({ _id: guildId });
  const guild = fakeGuild(guildId);

  await onMessageDelete(fakeClient(), { partial: true, guild, guildId });

  assert.equal((await entriesFor(guildId, "MESSAGE_DELETE")).length, 0);
});

test("a bot's own deleted message is not logged", async () => {
  const guildId = freshId();
  await guildModel.create({ _id: guildId });
  const guild = fakeGuild(guildId);

  await onMessageDelete(fakeClient(), {
    partial: false,
    guild,
    guildId,
    channelId: freshId(),
    content: "bot message",
    author: { id: freshId(), bot: true },
  });

  assert.equal((await entriesFor(guildId, "MESSAGE_DELETE")).length, 0);
});

/* ------------------------------------------------------------ messageUpdate */

test("editing a message's text logs MESSAGE_EDIT with a before/after preview", async () => {
  const guildId = freshId();
  await guildModel.create({ _id: guildId });
  const guild = fakeGuild(guildId);
  const channelId = freshId();
  const author = { id: freshId(), bot: false };

  const oldMessage = { partial: false, guild, channelId, content: "before", author };
  const newMessage = { partial: false, guild, channelId, content: "after", author };

  await onMessageUpdate(fakeClient(), oldMessage, newMessage);

  const entries = await entriesFor(guildId, "MESSAGE_EDIT");
  assert.equal(entries.length, 1);
  assert.match(entries[0].detail, /before/);
  assert.match(entries[0].detail, /after/);
});

test("an embed-only update (unfurl) with unchanged text is not logged as an edit", async () => {
  const guildId = freshId();
  await guildModel.create({ _id: guildId });
  const guild = fakeGuild(guildId);
  const channelId = freshId();
  const author = { id: freshId(), bot: false };

  const message = { partial: false, guild, channelId, content: "same text throughout", author };

  await onMessageUpdate(fakeClient(), message, { ...message });

  assert.equal((await entriesFor(guildId, "MESSAGE_EDIT")).length, 0);
});

test("a partial message on either side is skipped, not a crash", async () => {
  const guildId = freshId();
  await guildModel.create({ _id: guildId });
  const guild = fakeGuild(guildId);

  await assert.doesNotReject(
    onMessageUpdate(fakeClient(), { partial: true, guild }, { partial: false, guild, content: "x" })
  );
});

test("a bot's own edited message is not logged", async () => {
  const guildId = freshId();
  await guildModel.create({ _id: guildId });
  const guild = fakeGuild(guildId);
  const channelId = freshId();
  const author = { id: freshId(), bot: true };

  await onMessageUpdate(
    fakeClient(),
    { partial: false, guild, channelId, content: "before", author },
    { partial: false, guild, channelId, content: "after", author }
  );

  assert.equal((await entriesFor(guildId, "MESSAGE_EDIT")).length, 0);
});
