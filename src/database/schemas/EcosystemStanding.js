const mongoose = require("mongoose");

const nonNegativeSafeInteger = {
  type: Number,
  default: 0,
  min: 0,
  validate: Number.isSafeInteger,
};

const schema = new mongoose.Schema(
  {
    season_id: { type: String, required: true },
    guild_id: { type: String, required: true },
    user_id: { type: String, required: true },
    points: nonNegativeSafeInteger,
    xp: nonNegativeSafeInteger,
    messages: nonNegativeSafeInteger,
    last_activity_at: { type: Date, required: true },
  },
  {
    timestamps: {
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  }
);

schema.index({ season_id: 1, guild_id: 1, user_id: 1 }, { unique: true });
schema.index({ season_id: 1, points: -1 });
schema.index({ season_id: 1, guild_id: 1, points: -1 });

module.exports =
  mongoose.models.EcosystemStanding || mongoose.model("EcosystemStanding", schema, "ecosystem_standings");
