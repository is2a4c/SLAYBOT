const mongoose = require("mongoose");

const Schema = new mongoose.Schema(
  {
    _id: { type: String },
    bucket_start: { type: Date, required: true },
    scope: { type: String, enum: ["global", "guild"], required: true },
    guild_id: { type: String, default: null },
    actor_hash: { type: String, required: true },
    expires_at: { type: Date, required: true },
  },
  {
    versionKey: false,
  }
);

Schema.index({ scope: 1, guild_id: 1, bucket_start: 1, actor_hash: 1 });
Schema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });

const Model = mongoose.models["telemetry-actor"]
  ? mongoose.model("telemetry-actor")
  : mongoose.model("telemetry-actor", Schema);

module.exports = Model;
