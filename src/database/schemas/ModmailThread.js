const mongoose = require("mongoose");

const Schema = new mongoose.Schema(
  {
    guild_id: { type: String, required: true },
    user_id: { type: String, required: true },
    // Thread inside the configured modmail channel.
    thread_id: { type: String, required: true },
    open: { type: Boolean, default: true },
    // Set while the member is barred from opening new threads.
    blocked: { type: Boolean, default: false },
    last_user_message_at: { type: Date, default: null },
    last_staff_message_at: { type: Date, default: null },
    closed_at: { type: Date, default: null },
    closed_by: { type: String, default: null },
    close_reason: { type: String, default: null },
    messages: { type: Number, default: 0 },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  }
);

// One open thread per member; closed threads are kept as history.
Schema.index({ guild_id: 1, user_id: 1, open: 1 });
Schema.index({ guild_id: 1, thread_id: 1 }, { unique: true });

const Model = mongoose.models["modmail-thread"]
  ? mongoose.model("modmail-thread")
  : mongoose.model("modmail-thread", Schema);

module.exports = {
  model: Model,

  getOpenThread: (guildId, userId) => Model.findOne({ guild_id: guildId, user_id: userId, open: true }),

  getThreadById: (guildId, threadId) => Model.findOne({ guild_id: guildId, thread_id: threadId }),

  createThread: ({ guildId, userId, threadId }) =>
    Model.create({ guild_id: guildId, user_id: userId, thread_id: threadId, open: true }),

  closeThread: ({ guildId, threadId, closedBy, reason }) =>
    Model.findOneAndUpdate(
      { guild_id: guildId, thread_id: threadId, open: true },
      { $set: { open: false, closed_at: new Date(), closed_by: closedBy || null, close_reason: reason || null } },
      { new: true }
    ),

  /**
   * Blocks are stored on the member's most recent thread so history and the block
   * live together; a blocked member keeps a closed thread as the marker.
   */
  setBlocked: async ({ guildId, userId, blocked }) => {
    const existing = await Model.findOne({ guild_id: guildId, user_id: userId }).sort({ created_at: -1 });
    if (existing) {
      existing.blocked = blocked;
      if (blocked) existing.open = false;
      await existing.save();
      return existing;
    }
    if (!blocked) return null;
    return Model.create({ guild_id: guildId, user_id: userId, thread_id: `blocked-${userId}`, open: false, blocked });
  },

  isBlocked: async (guildId, userId) => {
    const latest = await Model.findOne({ guild_id: guildId, user_id: userId }).sort({ created_at: -1 }).lean();
    return Boolean(latest?.blocked);
  },

  listOpenThreads: (guildId, limit = 25) =>
    Model.find({ guild_id: guildId, open: true }).sort({ created_at: 1 }).limit(limit).lean(),

  deleteGuildThreads: (guildId) => Model.deleteMany({ guild_id: guildId }),
};
