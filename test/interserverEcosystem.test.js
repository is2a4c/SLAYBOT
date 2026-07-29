const test = require("node:test");
const assert = require("node:assert/strict");

require("module-alias/register");

const {
  EcosystemService,
  calculateSeasonReward,
  getPreviousSeasonWindow,
  getSeasonWindow,
  validateActivityInput,
} = require("../src/services/ecosystem/EcosystemService");

test("AC-1: builds stable UTC season windows including the year boundary", () => {
  assert.deepEqual(getSeasonWindow(new Date("2026-07-29T18:20:00+03:00")), {
    id: "2026-07",
    startsAt: new Date("2026-07-01T00:00:00.000Z"),
    endsAt: new Date("2026-08-01T00:00:00.000Z"),
  });
  assert.deepEqual(getSeasonWindow(new Date("2026-12-31T23:59:59.999Z")), {
    id: "2026-12",
    startsAt: new Date("2026-12-01T00:00:00.000Z"),
    endsAt: new Date("2027-01-01T00:00:00.000Z"),
  });
  assert.deepEqual(getPreviousSeasonWindow(new Date("2027-01-15T00:00:00.000Z")), {
    id: "2026-12",
    startsAt: new Date("2026-12-01T00:00:00.000Z"),
    endsAt: new Date("2027-01-01T00:00:00.000Z"),
  });
});

test("EC-1/EC-2: rejects unsafe activity values and missing Discord identifiers", () => {
  const valid = { eventId: "message-1", guildId: "guild-1", userId: "user-1", xp: 12 };
  assert.doesNotThrow(() => validateActivityInput(valid));

  for (const xp of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => validateActivityInput({ ...valid, xp }), /positive safe integer/);
  }
  for (const key of ["eventId", "guildId", "userId"]) {
    assert.throws(() => validateActivityInput({ ...valid, [key]: "" }), new RegExp(key));
  }
});

test("AC-2/EC-7: duplicate Discord events increment a standing only once", async () => {
  const activities = new Set();
  const increments = [];
  const service = new EcosystemService({
    activityModel: {
      create: async ({ event_id: eventId }) => {
        if (activities.has(eventId)) throw Object.assign(new Error("duplicate"), { code: 11000 });
        activities.add(eventId);
      },
      deleteOne: async ({ event_id: eventId }) => activities.delete(eventId),
    },
    standingModel: {
      findOneAndUpdate: async (filter, update) => increments.push({ filter, update }),
    },
    userModel: {},
  });
  const activity = {
    eventId: "message-1",
    guildId: "guild-1",
    userId: "user-1",
    xp: 12,
    occurredAt: new Date("2026-07-29T12:00:00.000Z"),
  };

  assert.deepEqual(await service.recordActivity(activity), {
    applied: true,
    seasonId: "2026-07",
    points: 12,
  });
  assert.deepEqual(await service.recordActivity(activity), {
    applied: false,
    seasonId: "2026-07",
    points: 0,
  });
  assert.equal(increments.length, 1);
  assert.deepEqual(increments[0].update.$inc, { points: 12, xp: 12, messages: 1 });
});

test("AC-8: failed standing updates remove the reservation so the event can be retried", async () => {
  let deletedEventId;
  const service = new EcosystemService({
    activityModel: {
      create: async () => {},
      deleteOne: async ({ event_id: eventId }) => {
        deletedEventId = eventId;
      },
    },
    standingModel: {
      findOneAndUpdate: async () => {
        throw new Error("database unavailable");
      },
    },
    userModel: {},
  });

  await assert.rejects(
    service.recordActivity({ eventId: "retry-me", guildId: "guild", userId: "user", xp: 4 }),
    /database unavailable/
  );
  assert.equal(deletedEventId, "retry-me");
});

test("AC-4/AC-5: player and server leaderboards use the active season and a ten-row limit", async () => {
  const pipelines = [];
  const service = new EcosystemService({
    activityModel: {},
    standingModel: {
      aggregate: async (pipeline) => {
        pipelines.push(pipeline);
        return [];
      },
    },
    userModel: {},
  });

  await service.getLeaderboard("players", new Date("2026-07-29T00:00:00.000Z"));
  await service.getLeaderboard("servers", new Date("2026-07-29T00:00:00.000Z"));

  assert.deepEqual(pipelines[0][0], { $match: { season_id: "2026-07" } });
  assert.deepEqual(pipelines[0][1].$group._id, "$user_id");
  assert.deepEqual(pipelines[0].at(-1), { $limit: 10 });
  assert.deepEqual(pipelines[1][1].$group._id, "$guild_id");
  assert.deepEqual(pipelines[1].at(-1), { $limit: 10 });
});

test("AC-6: global profile and wealth leaderboard use the existing shared wallet", async () => {
  let wealthPipeline;
  const service = new EcosystemService({
    activityModel: {},
    standingModel: {
      aggregate: async () => [{ _id: "user-1", points: 42, xp: 42, messages: 3 }],
    },
    userModel: {
      findById: async () => ({ coins: 25, bank: 75 }),
      aggregate: async (pipeline) => {
        wealthPipeline = pipeline;
        return [{ id: "user-1", coins: 25, bank: 75, netWorth: 100 }];
      },
    },
  });

  assert.deepEqual(await service.getProfile("user-1", new Date("2026-07-29T00:00:00.000Z")), {
    userId: "user-1",
    seasonId: "2026-07",
    points: 42,
    xp: 42,
    messages: 3,
    coins: 25,
    bank: 75,
    netWorth: 100,
    titles: [],
  });
  assert.deepEqual(await service.getLeaderboard("wealth"), [{ id: "user-1", coins: 25, bank: 75, netWorth: 100 }]);
  assert.deepEqual(wealthPipeline.at(-1), { $limit: 10 });
});

test("AC-7: global command exposes matching prefix and slash subcommands", () => {
  const command = require("../src/commands/economy/global");
  assert.equal(command.name, "global");
  assert.deepEqual(
    command.command.subcommands.map((item) => item.trigger),
    ["profile [user]", "leaderboard <players|servers|wealth>", "season", "rewards", "claim"]
  );
  assert.deepEqual(
    command.slashCommand.options.map((item) => item.name),
    ["profile", "leaderboard", "season", "rewards", "claim"]
  );
  assert.equal(typeof command.messageRun, "function");
  assert.equal(typeof command.interactionRun, "function");
});

test("AC-9/AC-10/AC-11: season rewards combine rank, one milestone, and server victory", () => {
  const reward = calculateSeasonReward({
    seasonId: "2026-06",
    points: 8000,
    playerRank: 1,
    championGuildId: "guild-1",
    championContribution: 120,
  });

  assert.equal(reward.amount, 37500);
  assert.deepEqual(
    reward.breakdown.map(({ source, amount }) => ({ source, amount })),
    [
      { source: "rank", amount: 25000 },
      { source: "milestone", amount: 7500 },
      { source: "server", amount: 5000 },
    ]
  );
  assert.deepEqual(
    reward.titles.map((title) => title.id),
    ["global_champion_2026-06", "season_gold_2026-06", "server_champion_guild-1_2026-06"]
  );

  assert.equal(
    calculateSeasonReward({
      seasonId: "2026-06",
      points: 2000,
      playerRank: null,
      championGuildId: null,
      championContribution: 0,
    }).amount,
    2000
  );
});

test("EC-8/EC-9: no threshold means no prize and weak champion-server contribution earns no bonus", () => {
  assert.deepEqual(
    calculateSeasonReward({
      seasonId: "2026-06",
      points: 499,
      playerRank: null,
      championGuildId: "guild-1",
      championContribution: 99,
    }),
    { amount: 0, breakdown: [], titles: [] }
  );
});

test("AC-12: claim delegates one completed-season payout and refuses an empty prize", async () => {
  const claims = [];
  const service = new EcosystemService({
    activityModel: {},
    standingModel: {},
    userModel: {},
    rewardClaimer: async (input) => {
      claims.push(input);
      return { claimed: true, bank: input.amount };
    },
  });
  service.getRewardPreview = async () => ({
    seasonId: "2026-06",
    points: 8000,
    playerRank: 1,
    championGuildId: "guild-1",
    championContribution: 120,
    ...calculateSeasonReward({
      seasonId: "2026-06",
      points: 8000,
      playerRank: 1,
      championGuildId: "guild-1",
      championContribution: 120,
    }),
  });

  const result = await service.claimPreviousSeason("user-1", new Date("2026-07-29T00:00:00.000Z"));
  assert.equal(result.claimed, true);
  assert.equal(result.preview.amount, 37500);
  assert.deepEqual(claims[0], {
    userId: "user-1",
    seasonId: "2026-06",
    amount: 37500,
    titles: result.preview.titles,
  });

  service.getRewardPreview = async () => ({
    seasonId: "2026-06",
    points: 0,
    playerRank: null,
    championGuildId: null,
    championContribution: 0,
    amount: 0,
    breakdown: [],
    titles: [],
  });
  assert.deepEqual(await service.claimPreviousSeason("user-2", new Date("2026-07-29T00:00:00.000Z")), {
    claimed: false,
    reason: "NO_REWARD",
    bank: 0,
    preview: await service.getRewardPreview(),
  });
  assert.equal(claims.length, 1);
});

test("MongoDB integration persists one event and aggregates cross-server standings", async () => {
  const mongoose = require("mongoose");
  const { MongoMemoryServer } = require("mongodb-memory-server");
  const Activity = require("../src/database/schemas/EcosystemActivity");
  const Standing = require("../src/database/schemas/EcosystemStanding");
  const mongo = await MongoMemoryServer.create();

  try {
    await mongoose.connect(mongo.getUri());
    await Promise.all([Activity.syncIndexes(), Standing.syncIndexes()]);
    const service = new EcosystemService({
      activityModel: Activity,
      standingModel: Standing,
      userModel: {},
    });
    const base = {
      guildId: "guild-1",
      userId: "user-1",
      occurredAt: new Date("2026-07-29T12:00:00.000Z"),
    };

    await service.recordActivity({ ...base, eventId: "message-1", xp: 8 });
    await service.recordActivity({ ...base, eventId: "message-1", xp: 8 });
    await service.recordActivity({ ...base, eventId: "message-2", xp: 7 });
    await service.recordActivity({
      ...base,
      eventId: "message-3",
      guildId: "guild-2",
      xp: 5,
    });

    assert.equal(await Activity.countDocuments(), 3);
    assert.deepEqual(await service.getLeaderboard("players", base.occurredAt), [
      { points: 20, xp: 20, messages: 3, id: "user-1" },
    ]);
    assert.deepEqual(await service.getLeaderboard("servers", base.occurredAt), [
      { points: 15, xp: 15, messages: 2, id: "guild-1" },
      { points: 5, xp: 5, messages: 1, id: "guild-2" },
    ]);
  } finally {
    await mongoose.disconnect();
    await mongo.stop();
  }
});

test("AC-12/EC-11: concurrent MongoDB claims credit the shared bank exactly once", async () => {
  const mongoose = require("mongoose");
  const { MongoMemoryServer } = require("mongodb-memory-server");
  const User = require("../src/database/schemas/User");
  const mongo = await MongoMemoryServer.create();
  const titles = [
    {
      id: "global_champion_2026-06",
      label: "Global Champion · 2026-06",
      seasonId: "2026-06",
    },
  ];

  try {
    await mongoose.connect(mongo.getUri());
    const results = await Promise.all([
      User.claimEcosystemReward({
        userId: "user-claim",
        seasonId: "2026-06",
        amount: 25000,
        titles,
      }),
      User.claimEcosystemReward({
        userId: "user-claim",
        seasonId: "2026-06",
        amount: 25000,
        titles,
      }),
    ]);
    const stored = await User.model.findById("user-claim").lean();

    assert.equal(results.filter((result) => result.claimed).length, 1);
    assert.equal(stored.bank, 25000);
    assert.deepEqual(stored.ecosystem.claimed_seasons, ["2026-06"]);
    assert.equal(stored.ecosystem.titles.length, 1);
  } finally {
    await mongoose.disconnect();
    await mongo.stop();
  }
});
