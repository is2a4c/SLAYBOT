const mongoose = require("mongoose");

const ACTION_TYPES = ["SEND_MESSAGE", "SEND_DM", "CHANGE_ROLES", "ADD_REACTION"];
const MAX_CUSTOM_COMMANDS = 50;
const MAX_ACTIONS = 10;

const ActionSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    name: { type: String, required: true, maxlength: 80 },
    type: { type: String, enum: ACTION_TYPES, required: true },
    content: { type: String, default: null, maxlength: 2000 },
    embed_title: { type: String, default: null, maxlength: 256 },
    embed_description: { type: String, default: null, maxlength: 4096 },
    embed_color: { type: String, default: null, maxlength: 7 },
    channel_id: { type: String, default: null },
    tts: { type: Boolean, default: false },
    delete_after_seconds: { type: Number, default: 0, min: 0, max: 86400 },
    mention_roles: { type: [String], default: [] },
    emoji: { type: String, default: null, maxlength: 100 },
    add_roles: { type: [String], default: [] },
    remove_roles: { type: [String], default: [] },
  },
  { _id: false }
);

const Schema = new mongoose.Schema(
  {
    guild_id: { type: String, required: true, index: true },
    name: { type: String, required: true, lowercase: true, trim: true, minlength: 1, maxlength: 32 },
    description: { type: String, default: null, maxlength: 100 },
    group: { type: String, default: "CUSTOM", maxlength: 32 },
    enabled: { type: Boolean, default: true },
    cooldown_seconds: { type: Number, default: 0, min: 0, max: 86400 },
    delete_invocation: { type: Boolean, default: false },
    allowed_roles: { type: [String], default: [] },
    allowed_channels: { type: [String], default: [] },
    actions: {
      type: [ActionSchema],
      default: [],
      validate: [(value) => value.length <= MAX_ACTIONS, `A custom command can have at most ${MAX_ACTIONS} actions.`],
    },
    created_by: { type: String, default: null },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

Schema.index({ guild_id: 1, name: 1 }, { unique: true });

const model = mongoose.models["custom-command"]
  ? mongoose.model("custom-command")
  : mongoose.model("custom-command", Schema);

module.exports = {
  ACTION_TYPES,
  MAX_ACTIONS,
  MAX_CUSTOM_COMMANDS,
  model,
  deleteGuildCustomCommands: (guildId) => model.deleteMany({ guild_id: guildId }),
};
