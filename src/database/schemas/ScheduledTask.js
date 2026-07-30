const mongoose = require("mongoose");

const MAX_ATTEMPTS = 5;

const Schema = new mongoose.Schema(
  {
    type: { type: String, required: true },
    guild_id: { type: String, required: true },
    run_at: { type: Date, required: true },
    payload: { type: mongoose.Schema.Types.Mixed, default: {} },
    // Stable identity of the work item. Re-scheduling the same key reschedules
    // instead of piling up duplicates (e.g. extending an existing temp role).
    dedupe_key: { type: String },
    attempts: { type: Number, default: 0 },
    // Set while a worker owns the task. A crashed worker's lease simply expires.
    locked_until: { type: Date, default: null },
    last_error: { type: String, default: null },
  },
  {
    timestamps: {
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  }
);

Schema.index({ run_at: 1, locked_until: 1 });
Schema.index({ type: 1, guild_id: 1, run_at: 1 });
Schema.index({ dedupe_key: 1 }, { unique: true, sparse: true });

const Model = mongoose.models["scheduled-task"]
  ? mongoose.model("scheduled-task")
  : mongoose.model("scheduled-task", Schema);

/**
 * Backoff for a task whose handler threw. Grows with the attempt count so a
 * permanently broken payload cannot hot-loop the poller.
 * @param {number} attempts
 */
function backoffMs(attempts) {
  return Math.min(60_000 * 2 ** Math.max(0, attempts - 1), 30 * 60_000);
}

module.exports = {
  model: Model,
  MAX_ATTEMPTS,
  backoffMs,

  /**
   * Queue a task, replacing any pending task that carries the same dedupe key.
   * @param {{type: string, guildId: string, runAt: Date|number, payload?: object, dedupeKey?: string}} task
   */
  scheduleTask: async ({ type, guildId, runAt, payload = {}, dedupeKey }) => {
    if (!type) throw new Error("Scheduled task requires a type");
    if (!guildId) throw new Error("Scheduled task requires a guildId");

    const at = runAt instanceof Date ? runAt : new Date(runAt);
    if (Number.isNaN(at.getTime())) throw new Error("Scheduled task requires a valid runAt");

    const fields = {
      type,
      guild_id: guildId,
      run_at: at,
      payload,
      attempts: 0,
      locked_until: null,
      last_error: null,
    };

    if (dedupeKey) {
      return Model.findOneAndUpdate(
        { dedupe_key: dedupeKey },
        { $set: { ...fields, dedupe_key: dedupeKey } },
        { upsert: true, new: true }
      );
    }

    return Model.create(fields);
  },

  /**
   * Atomically take ownership of up to `limit` due tasks.
   * @param {{limit?: number, leaseMs?: number, now?: Date, types?: string[]}} options
   */
  claimDueTasks: async ({ limit = 25, leaseMs = 60_000, now = new Date(), types } = {}) => {
    const claimed = [];

    for (let i = 0; i < limit; i += 1) {
      const filter = {
        run_at: { $lte: now },
        $or: [{ locked_until: null }, { locked_until: { $lte: now } }],
      };
      if (Array.isArray(types) && types.length > 0) filter.type = { $in: types };

      const task = await Model.findOneAndUpdate(
        filter,
        { $set: { locked_until: new Date(now.getTime() + leaseMs) }, $inc: { attempts: 1 } },
        { sort: { run_at: 1 }, new: true }
      ).lean();

      if (!task) break;
      claimed.push(task);
    }

    return claimed;
  },

  /**
   * @param {string|import('mongoose').Types.ObjectId} id
   */
  completeTask: (id) => Model.deleteOne({ _id: id }),

  /**
   * Release a failed task for a later retry, or drop it once it is hopeless.
   * @param {object} task claimed task document
   * @param {Error} error
   */
  failTask: async (task, error) => {
    const message = String(error?.message || error).slice(0, 500);
    if (task.attempts >= MAX_ATTEMPTS) {
      await Model.deleteOne({ _id: task._id });
      return { dropped: true, message };
    }

    await Model.updateOne(
      { _id: task._id },
      { $set: { locked_until: null, last_error: message, run_at: new Date(Date.now() + backoffMs(task.attempts)) } }
    );
    return { dropped: false, message };
  },

  /**
   * @param {{type?: string, guildId?: string, dedupeKey?: string, payloadMatch?: object}} filter
   */
  cancelTasks: async ({ type, guildId, dedupeKey, payloadMatch } = {}) => {
    const query = {};
    if (type) query.type = type;
    if (guildId) query.guild_id = guildId;
    if (dedupeKey) query.dedupe_key = dedupeKey;
    if (payloadMatch) {
      Object.entries(payloadMatch).forEach(([key, value]) => {
        query[`payload.${key}`] = value;
      });
    }
    if (Object.keys(query).length === 0) throw new Error("Refusing to cancel every scheduled task");

    const result = await Model.deleteMany(query);
    return result.deletedCount || 0;
  },

  /**
   * @param {{type: string, guildId: string, payloadMatch?: object, limit?: number}} filter
   */
  listTasks: async ({ type, guildId, payloadMatch, limit = 50 } = {}) => {
    const query = {};
    if (type) query.type = type;
    if (guildId) query.guild_id = guildId;
    if (payloadMatch) {
      Object.entries(payloadMatch).forEach(([key, value]) => {
        query[`payload.${key}`] = value;
      });
    }
    return Model.find(query).sort({ run_at: 1 }).limit(limit).lean();
  },

  /**
   * @param {string} guildId
   */
  deleteGuildTasks: (guildId) => Model.deleteMany({ guild_id: guildId }),
};
