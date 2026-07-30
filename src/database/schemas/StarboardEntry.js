const mongoose = require("mongoose");

const Schema = new mongoose.Schema(
  {
    guild_id: { type: String, required: true },
    channel_id: { type: String, required: true },
    message_id: { type: String, required: true },
    // The mirrored message posted in the starboard channel.
    starboard_channel_id: { type: String, required: true },
    starboard_message_id: { type: String, default: null },
    author_id: { type: String, default: null },
    count: { type: Number, default: 0 },
    // Set when staff removed the mirror by hand: the entry must not come back.
    blocked: { type: Boolean, default: false },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  }
);

Schema.index({ guild_id: 1, message_id: 1 }, { unique: true });
Schema.index({ guild_id: 1, starboard_message_id: 1 });

const Model = mongoose.models["starboard-entry"]
  ? mongoose.model("starboard-entry")
  : mongoose.model("starboard-entry", Schema);

module.exports = {
  model: Model,

  /**
   * @param {string} guildId
   * @param {string} messageId
   */
  getEntry: (guildId, messageId) => Model.findOne({ guild_id: guildId, message_id: messageId }),

  /**
   * @param {string} guildId
   * @param {string} starboardMessageId
   */
  getEntryByMirror: (guildId, starboardMessageId) =>
    Model.findOne({ guild_id: guildId, starboard_message_id: starboardMessageId }),

  /**
   * @param {object} entry
   */
  upsertEntry: ({ guildId, channelId, messageId, starboardChannelId, starboardMessageId, authorId, count }) =>
    Model.findOneAndUpdate(
      { guild_id: guildId, message_id: messageId },
      {
        $set: {
          channel_id: channelId,
          starboard_channel_id: starboardChannelId,
          starboard_message_id: starboardMessageId,
          author_id: authorId,
          count,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ),

  /**
   * @param {string} guildId
   * @param {string} messageId
   */
  deleteEntry: (guildId, messageId) => Model.deleteOne({ guild_id: guildId, message_id: messageId }),

  /**
   * @param {string} guildId
   * @param {string} messageId
   */
  blockEntry: (guildId, messageId) =>
    Model.updateOne(
      { guild_id: guildId, message_id: messageId },
      { $set: { blocked: true, starboard_message_id: null } }
    ),

  /**
   * @param {string} guildId
   * @param {number} limit
   */
  topEntries: (guildId, limit = 10) =>
    Model.find({ guild_id: guildId, starboard_message_id: { $ne: null } })
      .sort({ count: -1 })
      .limit(limit)
      .lean(),

  /**
   * @param {string} guildId
   */
  deleteGuildEntries: (guildId) => Model.deleteMany({ guild_id: guildId }),
};
