const EcosystemActivity = require("@schemas/EcosystemActivity");
const EcosystemStanding = require("@schemas/EcosystemStanding");
const User = require("@schemas/User");

const LEADERBOARD_LIMIT = 10;
const SERVER_CHAMPION_MIN_POINTS = 100;

function getSeasonWindow(input = new Date()) {
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) throw new TypeError("A valid season date is required");

  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const startsAt = new Date(Date.UTC(year, month, 1));
  const endsAt = new Date(Date.UTC(year, month + 1, 1));

  return {
    id: `${year}-${String(month + 1).padStart(2, "0")}`,
    startsAt,
    endsAt,
  };
}

function getPreviousSeasonWindow(input = new Date()) {
  const current = getSeasonWindow(input);
  return getSeasonWindow(new Date(current.startsAt.getTime() - 1));
}

function calculateSeasonReward({ seasonId, points, playerRank, championGuildId, championContribution }) {
  const breakdown = [];
  const titles = [];
  const rankRewards = { 1: 25000, 2: 15000, 3: 10000 };
  const rankAmount = rankRewards[playerRank] || (playerRank >= 4 && playerRank <= 10 ? 5000 : 0);

  if (rankAmount) {
    const title =
      playerRank === 1
        ? { id: `global_champion_${seasonId}`, label: `Global Champion · ${seasonId}` }
        : playerRank <= 3
          ? { id: `global_podium_${seasonId}`, label: `Global Podium · ${seasonId}` }
          : { id: `global_top10_${seasonId}`, label: `Global Top 10 · ${seasonId}` };
    breakdown.push({ source: "rank", amount: rankAmount, label: `Global rank #${playerRank}` });
    titles.push({ ...title, seasonId });
  }

  const milestones = [
    { points: 7500, amount: 7500, tier: "gold", label: "Season Gold" },
    { points: 2000, amount: 2000, tier: "silver", label: "Season Silver" },
    { points: 500, amount: 500, tier: "bronze", label: "Season Bronze" },
  ];
  const milestone = milestones.find((item) => points >= item.points);
  if (milestone) {
    breakdown.push({
      source: "milestone",
      amount: milestone.amount,
      label: `${milestone.points.toLocaleString("en-US")} season points`,
    });
    titles.push({
      id: `season_${milestone.tier}_${seasonId}`,
      label: `${milestone.label} · ${seasonId}`,
      seasonId,
    });
  }

  if (championGuildId && championContribution >= SERVER_CHAMPION_MIN_POINTS) {
    breakdown.push({ source: "server", amount: 5000, label: "Champion server contributor" });
    titles.push({
      id: `server_champion_${championGuildId}_${seasonId}`,
      label: `Server Champion · ${seasonId}`,
      seasonId,
    });
  }

  return {
    amount: breakdown.reduce((total, item) => total + item.amount, 0),
    breakdown,
    titles,
  };
}

function validateActivityInput({ eventId, guildId, userId, xp } = {}) {
  for (const [name, value] of Object.entries({ eventId, guildId, userId })) {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new TypeError(`${name} must be a non-empty string`);
    }
  }
  if (!Number.isSafeInteger(xp) || xp <= 0) {
    throw new TypeError("xp must be a positive safe integer");
  }
}

function isDuplicateKey(error) {
  return error?.code === 11000;
}

class EcosystemService {
  constructor({
    activityModel = EcosystemActivity,
    standingModel = EcosystemStanding,
    userModel = User.model,
    rewardClaimer = User.claimEcosystemReward,
  } = {}) {
    this.activityModel = activityModel;
    this.standingModel = standingModel;
    this.userModel = userModel;
    this.rewardClaimer = rewardClaimer;
  }

  async recordActivity(input) {
    validateActivityInput(input);
    const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();
    if (Number.isNaN(occurredAt.getTime())) throw new TypeError("occurredAt must be a valid date");

    const season = getSeasonWindow(occurredAt);
    const event = {
      event_id: input.eventId.trim(),
      season_id: season.id,
      guild_id: input.guildId.trim(),
      user_id: input.userId.trim(),
      xp: input.xp,
      points: input.xp,
      occurred_at: occurredAt,
    };

    try {
      await this.activityModel.create(event);
    } catch (error) {
      if (isDuplicateKey(error)) {
        return { applied: false, seasonId: season.id, points: 0 };
      }
      throw error;
    }

    try {
      await this.standingModel.findOneAndUpdate(
        {
          season_id: event.season_id,
          guild_id: event.guild_id,
          user_id: event.user_id,
        },
        {
          $inc: { points: event.points, xp: event.xp, messages: 1 },
          $set: { last_activity_at: occurredAt },
          $setOnInsert: {
            season_id: event.season_id,
            guild_id: event.guild_id,
            user_id: event.user_id,
          },
        },
        { upsert: true, setDefaultsOnInsert: true }
      );
    } catch (error) {
      await this.activityModel.deleteOne({ event_id: event.event_id }).catch(() => {});
      throw error;
    }

    return { applied: true, seasonId: season.id, points: event.points };
  }

  async getLeaderboard(type, at = new Date()) {
    if (type === "wealth") return this.getWealthLeaderboard();
    if (type !== "players" && type !== "servers") {
      throw new TypeError("Leaderboard type must be players, servers, or wealth");
    }

    const season = getSeasonWindow(at);
    return this.getLeaderboardForSeason(type, season.id);
  }

  async getLeaderboardForSeason(type, seasonId) {
    if (type !== "players" && type !== "servers") {
      throw new TypeError("Season leaderboard type must be players or servers");
    }
    const groupField = type === "players" ? "$user_id" : "$guild_id";
    return this.standingModel.aggregate([
      { $match: { season_id: seasonId } },
      {
        $group: {
          _id: groupField,
          points: { $sum: "$points" },
          xp: { $sum: "$xp" },
          messages: { $sum: "$messages" },
        },
      },
      { $project: { _id: 0, id: "$_id", points: 1, xp: 1, messages: 1 } },
      { $sort: { points: -1, xp: -1, id: 1 } },
      { $limit: LEADERBOARD_LIMIT },
    ]);
  }

  async getRewardPreview(userId, at = new Date()) {
    if (typeof userId !== "string" || !userId) throw new TypeError("userId is required");
    const season = getPreviousSeasonWindow(at);
    const [players, servers, contributions] = await Promise.all([
      this.getLeaderboardForSeason("players", season.id),
      this.getLeaderboardForSeason("servers", season.id),
      this.standingModel.aggregate([
        { $match: { season_id: season.id, user_id: userId } },
        { $project: { _id: 0, guildId: "$guild_id", points: 1 } },
      ]),
    ]);
    const playerIndex = players.findIndex((row) => row.id === userId);
    const playerRank = playerIndex === -1 ? null : playerIndex + 1;
    const points = contributions.reduce((total, row) => total + safeAmount(row.points), 0);
    const championGuildId = servers[0]?.id || null;
    const championContribution = contributions.find((row) => row.guildId === championGuildId)?.points || 0;

    return {
      seasonId: season.id,
      points,
      playerRank,
      championGuildId,
      championContribution,
      ...calculateSeasonReward({
        seasonId: season.id,
        points,
        playerRank,
        championGuildId,
        championContribution,
      }),
    };
  }

  async claimPreviousSeason(userId, at = new Date()) {
    const preview = await this.getRewardPreview(userId, at);
    if (preview.amount === 0) {
      return { claimed: false, reason: "NO_REWARD", bank: 0, preview };
    }
    const result = await this.rewardClaimer({
      userId,
      seasonId: preview.seasonId,
      amount: preview.amount,
      titles: preview.titles,
    });
    return {
      claimed: result.claimed,
      reason: result.claimed ? undefined : "ALREADY_CLAIMED",
      bank: result.bank,
      preview,
    };
  }

  async getWealthLeaderboard() {
    return this.userModel.aggregate([
      {
        $project: {
          _id: 0,
          id: "$_id",
          coins: { $ifNull: ["$coins", 0] },
          bank: { $ifNull: ["$bank", 0] },
          netWorth: {
            $add: [{ $ifNull: ["$coins", 0] }, { $ifNull: ["$bank", 0] }],
          },
        },
      },
      { $match: { netWorth: { $gt: 0, $lte: Number.MAX_SAFE_INTEGER } } },
      { $sort: { netWorth: -1, id: 1 } },
      { $limit: LEADERBOARD_LIMIT },
    ]);
  }

  async getProfile(userId, at = new Date()) {
    if (typeof userId !== "string" || !userId) throw new TypeError("userId is required");
    const season = getSeasonWindow(at);
    const userQuery = this.userModel.findById(userId);
    const [standingRows, user] = await Promise.all([
      this.standingModel.aggregate([
        { $match: { season_id: season.id, user_id: userId } },
        {
          $group: {
            _id: "$user_id",
            points: { $sum: "$points" },
            xp: { $sum: "$xp" },
            messages: { $sum: "$messages" },
          },
        },
      ]),
      typeof userQuery?.lean === "function" ? userQuery.lean() : userQuery,
    ]);
    const standing = standingRows[0] || {};
    const coins = safeAmount(user?.coins);
    const bank = safeAmount(user?.bank);

    return {
      userId,
      seasonId: season.id,
      points: safeAmount(standing.points),
      xp: safeAmount(standing.xp),
      messages: safeAmount(standing.messages),
      coins,
      bank,
      netWorth: safeSum(coins, bank),
      titles: (user?.ecosystem?.titles || [])
        .slice(-3)
        .reverse()
        .map((title) => ({
          id: title.id,
          label: title.label,
          seasonId: title.season_id,
        })),
    };
  }
}

function safeAmount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function safeSum(left, right) {
  const total = left + right;
  return Number.isSafeInteger(total) ? total : Number.MAX_SAFE_INTEGER;
}

module.exports = {
  EcosystemService,
  LEADERBOARD_LIMIT,
  SERVER_CHAMPION_MIN_POINTS,
  calculateSeasonReward,
  getPreviousSeasonWindow,
  getSeasonWindow,
  validateActivityInput,
};
