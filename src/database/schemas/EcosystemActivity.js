const mongoose = require("mongoose");

const schema = new mongoose.Schema(
  {
    event_id: { type: String, required: true, unique: true },
    season_id: { type: String, required: true, index: true },
    guild_id: { type: String, required: true, index: true },
    user_id: { type: String, required: true, index: true },
    xp: {
      type: Number,
      required: true,
      validate: Number.isSafeInteger,
      min: 1,
    },
    points: {
      type: Number,
      required: true,
      validate: Number.isSafeInteger,
      min: 1,
    },
    occurred_at: { type: Date, required: true },
  },
  {
    timestamps: {
      createdAt: "created_at",
      updatedAt: false,
    },
  }
);

schema.index({ season_id: 1, user_id: 1 });
schema.index({ season_id: 1, guild_id: 1 });

module.exports =
  mongoose.models.EcosystemActivity || mongoose.model("EcosystemActivity", schema, "ecosystem_activities");
