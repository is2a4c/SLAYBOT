const test = require("node:test");
const assert = require("node:assert/strict");
require("module-alias/register");

const { runChannelAutomod } = require("@src/services/moderation/channelAutomod");

const issuer = { id: "moderator-1" };

function message(id, { bot = false, member = { id: `author-${id}` } } = {}) {
  return { id, author: { id: `author-${id}`, bot }, member, content: id };
}

function channel(id, messages = []) {
  const fetched = [];
  const guild = {
    members: {
      cache: new Map(),
      fetch: async (memberId) => {
        fetched.push(memberId);
        return null;
      },
    },
  };
  return {
    id,
    name: `channel-${id}`,
    guild,
    fetched,
    permissionsFor: () => ({ has: () => true }),
    messages: { fetch: async () => new Map(messages.map((entry) => [entry.id, entry])) },
  };
}

function settings() {
  return { modlog_channel: null };
}

test("replays history oldest to newest and aggregates automod results", async () => {
  const target = channel("c1", [message("3"), message("2"), message("1")]);
  const seen = [];
  const perform = async (entry) => {
    seen.push(entry.id);
    return entry.id === "2" ? { deleted: true, triggered: true, strikes: 2 } : { deleted: false, strikes: 0 };
  };

  const outcome = await runChannelAutomod({
    issuer,
    channels: [target],
    amount: 10,
    settings: settings(),
    perform,
  });

  assert.deepEqual(seen, ["1", "2", "3"], "history is processed in the order it was written");
  assert.equal(outcome.checked, 3);
  assert.equal(outcome.deleted, 1);
  assert.equal(outcome.strikes, 2);
  assert.equal(outcome.triggered, 1);
  assert.equal(outcome.results[0].status, "OK");
});

test("skips bots and messages whose author is no longer resolvable", async () => {
  const target = channel("c1", [message("1", { bot: true }), message("2", { member: null }), message("3")]);
  const seen = [];
  const perform = async (entry) => {
    seen.push(entry.id);
    return { deleted: false, strikes: 0 };
  };

  const outcome = await runChannelAutomod({ issuer, channels: [target], amount: 10, settings: settings(), perform });

  assert.deepEqual(seen, ["3"]);
  assert.equal(outcome.results[0].skipped, 2);
});

test("one failing message does not stop the scan", async () => {
  const target = channel("c1", [message("1"), message("2"), message("3")]);
  const perform = async (entry) => {
    if (entry.id === "2") throw new Error("classifier busy");
    return { deleted: true, strikes: 1 };
  };

  const outcome = await runChannelAutomod({ issuer, channels: [target], amount: 10, settings: settings(), perform });

  assert.equal(outcome.checked, 2);
  assert.equal(outcome.deleted, 2);
  assert.equal(outcome.failed, 1);
});

test("stops at the deadline and marks the rest as partial", async () => {
  const target = channel("c1", [message("1"), message("2"), message("3")]);
  const other = channel("c2", [message("4")]);
  let clock = 0;
  const perform = async () => {
    clock += 60;
    return { deleted: false, strikes: 0 };
  };

  const outcome = await runChannelAutomod({
    issuer,
    channels: [target, other],
    amount: 10,
    settings: settings(),
    perform,
    now: () => clock,
    budgetMs: 100,
  });

  assert.equal(outcome.partial, true);
  assert.equal(outcome.checked, 2);
  assert.equal(outcome.results[0].status, "PARTIAL");
  assert.equal(outcome.results[1].status, "SKIPPED");
});

test("refuses an invalid amount", async () => {
  const outcome = await runChannelAutomod({
    issuer,
    channels: [channel("c1")],
    amount: 0,
    settings: settings(),
    perform: async () => ({}),
  });
  assert.equal(outcome.error, "INVALID_AMOUNT");
});

test("reports a channel where the bot cannot read history", async () => {
  const target = channel("c1", [message("1")]);
  const botCheck = target.permissionsFor;
  target.permissionsFor = (who) => (who === issuer ? botCheck(who) : { has: () => false });

  const outcome = await runChannelAutomod({
    issuer,
    channels: [target],
    amount: 10,
    settings: settings(),
    perform: async () => ({}),
  });

  assert.equal(outcome.results[0].status, "BOT_PERM");
  assert.equal(outcome.checked, 0);
});
