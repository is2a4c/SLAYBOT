const mongoose = require("mongoose");

const MAX_OPTIONS = 10;
const MAX_QUESTION = 300;
const MAX_OPTION_LABEL = 80;

const Schema = new mongoose.Schema(
  {
    guild_id: { type: String, required: true },
    channel_id: { type: String, required: true },
    message_id: { type: String, required: true },
    author_id: { type: String, required: true },
    question: { type: String, required: true, maxlength: MAX_QUESTION },
    options: [
      {
        _id: false,
        label: { type: String, required: true, maxlength: MAX_OPTION_LABEL },
        emoji: { type: String, default: null },
      },
    ],
    // userId -> option indexes. A Map keeps one document per poll instead of one per vote.
    votes: { type: Map, of: [Number], default: () => new Map() },
    multi: { type: Boolean, default: false },
    anonymous: { type: Boolean, default: true },
    allow_change: { type: Boolean, default: true },
    ends_at: { type: Date, default: null },
    closed: { type: Boolean, default: false },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  }
);

Schema.index({ guild_id: 1, message_id: 1 }, { unique: true });
Schema.index({ guild_id: 1, closed: 1 });

const Model = mongoose.models["poll"] ? mongoose.model("poll") : mongoose.model("poll", Schema);

module.exports = {
  model: Model,
  MAX_OPTIONS,
  MAX_QUESTION,
  MAX_OPTION_LABEL,

  createPoll: (data) => Model.create(data),

  getPoll: (guildId, messageId) => Model.findOne({ guild_id: guildId, message_id: messageId }),

  listOpenPolls: (guildId, limit = 20) =>
    Model.find({ guild_id: guildId, closed: false }).sort({ created_at: -1 }).limit(limit).lean(),

  closePoll: (guildId, messageId) =>
    Model.findOneAndUpdate({ guild_id: guildId, message_id: messageId }, { $set: { closed: true } }, { new: true }),

  deletePoll: (guildId, messageId) => Model.deleteOne({ guild_id: guildId, message_id: messageId }),

  deleteGuildPolls: (guildId) => Model.deleteMany({ guild_id: guildId }),
};
