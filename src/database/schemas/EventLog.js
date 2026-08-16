const mongoose = require("mongoose");
const { EVENT_TYPES } = require("@src/services/eventRouter/catalog");

/**
 * What actually happened, independent of whether the server also asked to
 * have it posted to a channel - the routed post can fail (a deleted channel,
 * missing permissions) or never have been turned on at all, and the event
 * still happened either way.
 */

const MAX_PER_GUILD = 2000;

const Schema = new mongoose.Schema(
  {
    guild_id: { type: String, required: true, index: true },
    type: { type: String, required: true, enum: EVENT_TYPES },
    actor_id: { type: String, default: null },
    target_id: { type: String, default: null },
    channel_id: { type: String, default: null },
    detail: { type: String, default: null, maxlength: 300 },
    reason: { type: String, default: null, maxlength: 500 },
  },
  { timestamps: { createdAt: "created_at", updatedAt: false } }
);

Schema.index({ guild_id: 1, type: 1, created_at: -1 });

const Model = mongoose.models["event-log"] ? mongoose.model("event-log") : mongoose.model("event-log", Schema);

// A voice-heavy server can log dozens of entries an hour; trimming on every
// single write would mean a query on every single write. Checking on a small
// fraction of them keeps a guild near its cap without that cost.
const TRIM_CHECK_PROBABILITY = 0.02;

module.exports = {
  model: Model,
  MAX_PER_GUILD,

  createEventLog: async (data) => {
    const entry = await Model.create(data);

    if (Math.random() < TRIM_CHECK_PROBABILITY) {
      const excess = await Model.find({ guild_id: data.guild_id })
        .sort({ created_at: -1 })
        .skip(MAX_PER_GUILD)
        .select("_id")
        .lean();
      if (excess.length) await Model.deleteMany({ _id: { $in: excess.map((doc) => doc._id) } });
    }

    return entry;
  },

  listEventLogs: ({ guildId, type, memberId, channelId, page = 1, pageSize = 25 }) => {
    const filter = { guild_id: guildId };
    if (type) filter.type = type;
    if (memberId) filter.$or = [{ actor_id: memberId }, { target_id: memberId }];
    if (channelId) filter.channel_id = channelId;

    return Promise.all([
      Model.find(filter)
        .sort({ created_at: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean(),
      Model.countDocuments(filter),
    ]);
  },

  deleteGuildEventLogs: (guildId) => Model.deleteMany({ guild_id: guildId }),
};
