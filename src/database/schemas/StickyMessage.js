const mongoose = require("mongoose");

const Schema = new mongoose.Schema(
  {
    guild_id: { type: String, required: true },
    channel_id: { type: String, required: true },
    content: { type: String, required: true, maxlength: 2000 },
    // Rendered as an embed instead of plain text.
    embed: { type: Boolean, default: true },
    color: { type: String, default: null },
    title: { type: String, default: null },
    // Re-post rules: wait for N messages and M seconds before moving the sticky down.
    min_messages: { type: Number, default: 1, min: 1, max: 50 },
    cooldown_seconds: { type: Number, default: 5, min: 0, max: 3600 },
    last_message_id: { type: String, default: null },
    last_posted_at: { type: Date, default: null },
    enabled: { type: Boolean, default: true },
    created_by: { type: String, default: null },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  }
);

Schema.index({ guild_id: 1, channel_id: 1 }, { unique: true });

const Model = mongoose.models["sticky-message"]
  ? mongoose.model("sticky-message")
  : mongoose.model("sticky-message", Schema);

// channel_id -> sticky. Every message in a guild consults this, so it must not hit the database.
const stickyCache = new Map();

function cacheSticky(doc) {
  if (doc) stickyCache.set(doc.channel_id, doc);
  return doc;
}

module.exports = {
  model: Model,

  cacheStickyMessages: async (client) => {
    stickyCache.clear();
    const docs = await Model.find({ enabled: true }).lean();
    for (const doc of docs) {
      if (client && !client.guilds.cache.has(doc.guild_id)) continue;
      stickyCache.set(doc.channel_id, doc);
    }
    return stickyCache.size;
  },

  getCachedSticky: (channelId) => stickyCache.get(channelId),

  getSticky: (guildId, channelId) => Model.findOne({ guild_id: guildId, channel_id: channelId }).lean(),

  listStickies: (guildId) => Model.find({ guild_id: guildId }).lean(),

  /**
   * @param {object} data
   */
  saveSticky: async (data) =>
    cacheSticky(
      await Model.findOneAndUpdate(
        { guild_id: data.guild_id, channel_id: data.channel_id },
        { $set: data },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      ).lean()
    ),

  /**
   * Record where the sticky currently sits without a full document write.
   * @param {string} channelId
   * @param {string|null} messageId
   * @param {Date} postedAt
   */
  markPosted: async (channelId, messageId, postedAt = new Date()) => {
    const cached = stickyCache.get(channelId);
    if (cached) {
      cached.last_message_id = messageId;
      cached.last_posted_at = postedAt;
    }
    await Model.updateOne(
      { channel_id: channelId },
      { $set: { last_message_id: messageId, last_posted_at: postedAt } }
    );
  },

  deleteSticky: async (guildId, channelId) => {
    await Model.deleteOne({ guild_id: guildId, channel_id: channelId });
    stickyCache.delete(channelId);
  },

  deleteGuildStickies: async (guildId) => {
    for (const [channelId, sticky] of stickyCache) {
      if (sticky.guild_id === guildId) stickyCache.delete(channelId);
    }
    await Model.deleteMany({ guild_id: guildId });
  },
};
