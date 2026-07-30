const mongoose = require("mongoose");

const Schema = new mongoose.Schema(
  {
    guild_id: { type: String, required: true },
    user_id: { type: String, required: true },
    code: { type: String, required: true },
    tries: { type: Number, default: 0 },
    // TTL anchor: an unfinished challenge disappears on its own.
    expires_at: { type: Date, required: true },
  },
  { versionKey: false, timestamps: { createdAt: "created_at", updatedAt: false } }
);

Schema.index({ guild_id: 1, user_id: 1 }, { unique: true });
Schema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });

const Model = mongoose.models["verification-attempt"]
  ? mongoose.model("verification-attempt")
  : mongoose.model("verification-attempt", Schema);

module.exports = {
  model: Model,

  /**
   * @param {{guildId: string, userId: string, code: string, ttlMs: number}} input
   */
  startChallenge: ({ guildId, userId, code, ttlMs }) =>
    Model.findOneAndUpdate(
      { guild_id: guildId, user_id: userId },
      { $set: { code, tries: 0, expires_at: new Date(Date.now() + ttlMs) } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean(),

  getChallenge: (guildId, userId) => Model.findOne({ guild_id: guildId, user_id: userId }).lean(),

  /**
   * @param {string} guildId
   * @param {string} userId
   */
  registerTry: (guildId, userId) =>
    Model.findOneAndUpdate({ guild_id: guildId, user_id: userId }, { $inc: { tries: 1 } }, { new: true }).lean(),

  clearChallenge: (guildId, userId) => Model.deleteOne({ guild_id: guildId, user_id: userId }),

  deleteGuildChallenges: (guildId) => Model.deleteMany({ guild_id: guildId }),
};
