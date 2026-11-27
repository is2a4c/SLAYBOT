const test = require("node:test");
const assert = require("node:assert/strict");
require("module-alias/register");

const { ChannelType } = require("discord.js");
const {
  MAX_CHANNELS,
  MAX_PER_CHANNEL,
  MESSAGE_CHANNEL_TYPES,
  PURGE_METHODS,
  runChannelPurge,
} = require("@src/services/moderation/channelPurge");

const issuer = { id: "moderator-1" };

function channel(id, type = ChannelType.GuildText) {
  return { id, name: `channel-${id}`, type };
}

function recorder(outcomes = {}) {
  const calls = [];
  const purge = async (who, target, type, amount, argument) => {
    calls.push({ who, channel: target.id, type, amount, argument });
    const outcome = outcomes[target.id];
    if (outcome instanceof Error) throw outcome;
    return outcome ?? 0;
  };
  return { calls, purge };
}

test("voice and stage channels are accepted, categories are not", () => {
  assert.ok(MESSAGE_CHANNEL_TYPES.includes(ChannelType.GuildVoice), "text chat in a voice channel can be moderated");
  assert.ok(MESSAGE_CHANNEL_TYPES.includes(ChannelType.GuildStageVoice));
  assert.ok(!MESSAGE_CHANNEL_TYPES.includes(ChannelType.GuildCategory));
  assert.ok(!MESSAGE_CHANNEL_TYPES.includes(ChannelType.GuildForum), "a forum itself holds no messages, only threads");
});

test("every offered method maps to a purge type", () => {
  const expected = ["ALL", "USER", "BOT", "LINK", "ATTACHMENT", "TOKEN"];
  assert.deepEqual(
    PURGE_METHODS.map((method) => method.purgeType),
    expected
  );
  assert.equal(PURGE_METHODS.find((method) => method.id === "user").needsUser, true);
  assert.equal(PURGE_METHODS.find((method) => method.id === "contains").needsText, true);
});

test("runs the same method in every selected channel, voice channel text included", async () => {
  const channels = [
    channel("text-1", ChannelType.GuildText),
    channel("voice-1", ChannelType.GuildVoice),
    channel("thread-1", ChannelType.PublicThread),
  ];
  const { calls, purge } = recorder({ "text-1": 3, "voice-1": 5, "thread-1": 2 });

  const outcome = await runChannelPurge({
    issuer,
    channels,
    methodId: "all",
    amount: 25,
    purge,
  });

  assert.equal(calls.length, 3, "each selected channel is handled");
  assert.deepEqual(
    calls.map((call) => call.channel),
    ["text-1", "voice-1", "thread-1"]
  );
  assert.ok(calls.every((call) => call.type === "ALL" && call.amount === 25));
  assert.equal(outcome.deleted, 10);
  assert.deepEqual(
    outcome.results.map((entry) => entry.status),
    ["OK", "OK", "OK"]
  );
});

test("passes the target member or text through to the purge", async () => {
  const { calls, purge } = recorder({ "text-1": 1 });

  await runChannelPurge({
    issuer,
    channels: [channel("text-1")],
    methodId: "user",
    amount: 10,
    argument: "member-9",
    purge,
  });
  await runChannelPurge({
    issuer,
    channels: [channel("text-1")],
    methodId: "contains",
    amount: 10,
    argument: "bad word",
    purge,
  });

  assert.equal(calls[0].type, "USER");
  assert.equal(calls[0].argument, "member-9");
  assert.equal(calls[1].type, "TOKEN");
  assert.equal(calls[1].argument, "bad word");
});

test("a failing channel does not stop the others and is reported honestly", async () => {
  const channels = [channel("one"), channel("two"), channel("three"), channel("four")];
  const { purge } = recorder({
    one: 4,
    two: new Error("rate limited"),
    three: "MEMBER_PERM",
    four: "BOT_PERM",
  });

  const outcome = await runChannelPurge({ issuer, channels, methodId: "bots", amount: 20, purge });

  assert.deepEqual(
    outcome.results.map((entry) => entry.status),
    ["OK", "ERROR", "MEMBER_PERM", "BOT_PERM"]
  );
  assert.equal(outcome.deleted, 4);
});

test("clamps the amount to what Discord can delete at once", async () => {
  const { calls, purge } = recorder({ "text-1": 1 });

  const outcome = await runChannelPurge({
    issuer,
    channels: [channel("text-1")],
    methodId: "all",
    amount: 500,
    purge,
  });

  assert.equal(calls[0].amount, MAX_PER_CHANNEL);
  assert.equal(outcome.amount, MAX_PER_CHANNEL);
});

test("refuses an amount that is not a positive integer", async () => {
  const { calls, purge } = recorder({});
  for (const amount of [0, -5, "abc", ""]) {
    const outcome = await runChannelPurge({ issuer, channels: [channel("text-1")], methodId: "all", amount, purge });
    assert.equal(outcome.error, "INVALID_AMOUNT");
  }
  assert.equal(calls.length, 0);
});

test("refuses an unknown method", async () => {
  const { calls, purge } = recorder({});
  const outcome = await runChannelPurge({
    issuer,
    channels: [channel("text-1")],
    methodId: "nonsense",
    amount: 5,
    purge,
  });
  assert.equal(outcome.error, "INVALID_METHOD");
  assert.equal(calls.length, 0);
});

test("skips a selected channel that cannot hold messages", async () => {
  const { calls, purge } = recorder({});
  const outcome = await runChannelPurge({
    issuer,
    channels: [channel("category-1", ChannelType.GuildCategory), channel("text-1")],
    methodId: "all",
    amount: 5,
    purge,
  });

  assert.equal(outcome.results[0].status, "SKIPPED");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].channel, "text-1");
});

test("never handles more channels than Discord lets one panel select", async () => {
  const many = Array.from({ length: MAX_CHANNELS + 5 }, (_, index) => channel(`c-${index}`));
  const { calls, purge } = recorder({});

  await runChannelPurge({ issuer, channels: many, methodId: "all", amount: 1, purge });

  assert.equal(calls.length, MAX_CHANNELS);
});
