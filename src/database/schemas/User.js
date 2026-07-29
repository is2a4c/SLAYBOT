const mongoose = require("mongoose");
const { CACHE_SIZE } = require("@root/config.js");
const FixedSizeMap = require("fixedsize-map");

const cache = new FixedSizeMap(CACHE_SIZE.USERS);

const EcosystemTitleSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    label: { type: String, required: true },
    season_id: { type: String, required: true },
    earned_at: { type: Date, required: true },
  },
  { _id: false }
);

const Schema = new mongoose.Schema(
  {
    _id: String,
    username: String,
    discriminator: String,
    global_name: String,
    logged: Boolean,
    coins: { type: Number, default: 0 },
    bank: { type: Number, default: 0 },
    reputation: {
      received: { type: Number, default: 0 },
      given: { type: Number, default: 0 },
      timestamp: Date,
    },
    daily: {
      streak: { type: Number, default: 0 },
      timestamp: Date,
    },
    ecosystem: {
      claimed_seasons: { type: [String], default: [] },
      titles: { type: [EcosystemTitleSchema], default: [] },
    },
  },
  {
    timestamps: {
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  }
);

const Model = mongoose.models["user"] ? mongoose.model("user") : mongoose.model("user", Schema);

module.exports = {
  model: Model,

  /**
   * @param {import('discord.js').User} user
   */
  getUser: async (user) => {
    if (!user) throw new Error("User is required.");
    if (!user.id) throw new Error("User Id is required.");

    const cached = cache.get(user.id);
    if (cached) return cached;

    let userDb = await Model.findById(user.id);
    if (!userDb) {
      userDb = new Model({
        _id: user.id,
        username: user.username,
        discriminator: user.discriminator || "0",
        global_name: user.globalName,
      });
    }

    // Temporary fix for users who where added to DB before v5.0.0
    // Update username and discriminator in previous DB
    else if (!userDb.username || !userDb.discriminator) {
      userDb.username = user.username;
      userDb.discriminator = user.discriminator || "0";
      userDb.global_name = user.globalName;
    }

    cache.add(user.id, userDb);
    return userDb;
  },

  getReputationLb: async (limit = 10) => {
    return Model.find({ "reputation.received": { $gt: 0 } })
      .sort({ "reputation.received": -1, "reputation.given": 1 })
      .limit(limit)
      .lean();
  },

  claimEcosystemReward: async ({ userId, seasonId, amount, titles }) => {
    if (!userId || !seasonId) throw new TypeError("userId and seasonId are required");
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      throw new TypeError("amount must be a positive safe integer");
    }

    const earnedAt = new Date();
    const storedTitles = titles.map((title) => ({
      id: title.id,
      label: title.label,
      season_id: title.seasonId,
      earned_at: earnedAt,
    }));
    let updated;

    try {
      updated = await Model.findOneAndUpdate(
        {
          _id: userId,
          "ecosystem.claimed_seasons": { $ne: seasonId },
        },
        {
          $inc: { bank: amount },
          $addToSet: {
            "ecosystem.claimed_seasons": seasonId,
            "ecosystem.titles": { $each: storedTitles },
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: false }
      );
    } catch (error) {
      if (error?.code !== 11000) throw error;
    }

    if (!updated) {
      const existing = await Model.findById(userId).lean();
      return { claimed: false, bank: existing?.bank || 0 };
    }

    const cached = cache.get(userId);
    if (cached) {
      cached.bank = updated.bank;
      cached.ecosystem = updated.ecosystem;
    }
    return { claimed: true, bank: updated.bank };
  },
};
