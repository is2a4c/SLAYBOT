const mongoose = require("mongoose");

const FEED_TYPES = ["TWITCH", "YOUTUBE", "RSS", "GITHUB"];
const MAX_FEEDS_PER_GUILD = 25;

const Schema = new mongoose.Schema(
  {
    guild_id: { type: String, required: true },
    type: { type: String, enum: FEED_TYPES, required: true },
    // Twitch login, YouTube channel id, owner/repo, or an RSS url.
    target: { type: String, required: true },
    channel_id: { type: String, required: true },
    // Optional role or text prepended to the announcement.
    mention: { type: String, default: null },
    message: { type: String, default: null, maxlength: 1000 },
    enabled: { type: Boolean, default: true },
    // Identifier of the last item announced, so a restart never re-posts.
    last_item_id: { type: String, default: null },
    last_checked_at: { type: Date, default: null },
    last_error: { type: String, default: null },
    consecutive_failures: { type: Number, default: 0 },
    created_by: { type: String, default: null },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  }
);

Schema.index({ guild_id: 1, type: 1, target: 1, channel_id: 1 }, { unique: true });
Schema.index({ enabled: 1, type: 1 });

const Model = mongoose.models["feed"] ? mongoose.model("feed") : mongoose.model("feed", Schema);

module.exports = {
  model: Model,
  FEED_TYPES,
  MAX_FEEDS_PER_GUILD,

  createFeed: (data) => Model.create(data),

  countFeeds: (guildId) => Model.countDocuments({ guild_id: guildId }),

  listFeeds: (guildId) => Model.find({ guild_id: guildId }).sort({ type: 1, target: 1 }).lean(),

  listEnabledFeeds: (limit = 500) => Model.find({ enabled: true }).limit(limit),

  findFeed: ({ guildId, type, target, channelId }) =>
    Model.findOne({ guild_id: guildId, type, target, channel_id: channelId }),

  deleteFeed: ({ guildId, type, target, channelId }) =>
    Model.deleteOne({ guild_id: guildId, type, target, ...(channelId ? { channel_id: channelId } : {}) }),

  deleteGuildFeeds: (guildId) => Model.deleteMany({ guild_id: guildId }),
};
