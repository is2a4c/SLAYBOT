const mongoose = require("mongoose");

const counterFields = {
  messages: { type: Number, default: 0 },
  interactions: { type: Number, default: 0 },
  commands: { type: Number, default: 0 },
  command_successes: { type: Number, default: 0 },
  command_failures: { type: Number, default: 0 },
  slash_commands: { type: Number, default: 0 },
  prefix_commands: { type: Number, default: 0 },
  context_commands: { type: Number, default: 0 },
  button_interactions: { type: Number, default: 0 },
  modal_interactions: { type: Number, default: 0 },
  automod_actions: { type: Number, default: 0 },
  automod_deletions: { type: Number, default: 0 },
  automod_strikes: { type: Number, default: 0 },
  member_joins: { type: Number, default: 0 },
  member_leaves: { type: Number, default: 0 },
  guild_joins: { type: Number, default: 0 },
  guild_leaves: { type: Number, default: 0 },
  voice_joins: { type: Number, default: 0 },
  voice_leaves: { type: Number, default: 0 },
  voice_seconds: { type: Number, default: 0 },
  client_errors: { type: Number, default: 0 },
  client_warnings: { type: Number, default: 0 },
};

const Schema = new mongoose.Schema(
  {
    _id: { type: String },
    bucket_start: { type: Date, required: true },
    scope: { type: String, enum: ["global", "guild"], required: true },
    guild_id: { type: String, default: null },
    counters: counterFields,
    command_usage: {
      type: Map,
      of: Number,
      default: {},
    },
    command_latency: {
      total_ms: { type: Number, default: 0 },
      samples: { type: Number, default: 0 },
      max_ms: { type: Number, default: 0 },
    },
    expires_at: { type: Date, required: true },
  },
  {
    versionKey: false,
  }
);

Schema.index({ scope: 1, guild_id: 1, bucket_start: 1 });
Schema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });

const Model = mongoose.models["telemetry-bucket"]
  ? mongoose.model("telemetry-bucket")
  : mongoose.model("telemetry-bucket", Schema);

module.exports = Model;
