const test = require("node:test");
const assert = require("node:assert/strict");
require("module-alias/register");

const {
  SubscriptionError,
  createSubscription,
  deleteSubscription,
  setSubscriptionEnabled,
} = require("../dashboard/services/subscriptions");

const GUILD_ID = "100000000000000000";
const CHANNEL_ID = "100000000000000001";
const ROLE_ID = "100000000000000002";

function guild() {
  const channel = {
    id: CHANNEL_ID,
    isTextBased: () => true,
    isThread: () => false,
    permissionsFor: () => ({ has: () => true }),
  };
  return {
    id: GUILD_ID,
    members: { me: { id: "bot" } },
    channels: { cache: new Map([[CHANNEL_ID, channel]]) },
    roles: { cache: new Map([[ROLE_ID, { id: ROLE_ID, managed: false }]]) },
  };
}

test("dashboard creates a validated subscription without announcing its current item", async () => {
  let stored;
  const result = await createSubscription(
    guild(),
    { type: "twitch", target: "Streamer", channelId: CHANNEL_ID, roleId: ROLE_ID, message: "Live now" },
    "actor",
    {
      countFeeds: async () => 0,
      fetchLatest: async () => ({ id: "current" }),
      model: { findOne: async () => null },
      createFeed: async (value) => {
        stored = value;
        return { ...value, _id: "feed" };
      },
    }
  );

  assert.equal(result._id, "feed");
  assert.equal(stored.type, "TWITCH");
  assert.equal(stored.target, "streamer");
  assert.equal(stored.last_item_id, "current");
  assert.equal(stored.mention, `<@&${ROLE_ID}>`);
});

test("dashboard subscriptions reject unknown Discord channels and duplicates", async () => {
  await assert.rejects(
    () =>
      createSubscription(guild(), { type: "TWITCH", target: "streamer", channelId: ROLE_ID }, "actor", {
        countFeeds: async () => 0,
        fetchLatest: async () => ({ id: "current" }),
        model: { findOne: async () => null },
      }),
    SubscriptionError
  );

  await assert.rejects(
    () =>
      createSubscription(guild(), { type: "TWITCH", target: "streamer", channelId: CHANNEL_ID }, "actor", {
        countFeeds: async () => 0,
        fetchLatest: async () => ({ id: "current" }),
        model: { findOne: async () => ({ _id: "existing" }) },
      }),
    /already exists/
  );
});

test("toggle and delete stay scoped to the selected guild", async () => {
  const feed = { enabled: false, save: async () => {} };
  const queries = [];
  const model = {
    findOne: async (query) => {
      queries.push(query);
      return feed;
    },
    deleteOne: async (query) => {
      queries.push(query);
      return { deletedCount: 1 };
    },
  };
  await setSubscriptionEnabled(GUILD_ID, "a".repeat(24), true, model);
  await deleteSubscription(GUILD_ID, "a".repeat(24), model);
  assert.equal(feed.enabled, true);
  assert.deepEqual(queries, [
    { _id: "a".repeat(24), guild_id: GUILD_ID },
    { _id: "a".repeat(24), guild_id: GUILD_ID },
  ]);
});
