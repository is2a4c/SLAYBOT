const mongoose = require("mongoose");

const MAX_BACKUPS_PER_GUILD = 5;

const Schema = new mongoose.Schema(
  {
    guild_id: { type: String, required: true },
    // Short human-friendly id used by the commands.
    backup_id: { type: String, required: true },
    created_by: { type: String, default: null },
    name: { type: String, default: null },
    // Snapshot of roles, channels and server settings. Structure only - never messages.
    data: { type: mongoose.Schema.Types.Mixed, required: true },
    counts: {
      roles: { type: Number, default: 0 },
      channels: { type: Number, default: 0 },
      categories: { type: Number, default: 0 },
      emojis: { type: Number, default: 0 },
    },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: false },
  }
);

Schema.index({ guild_id: 1, backup_id: 1 }, { unique: true });

const Model = mongoose.models["guild-backup"] ? mongoose.model("guild-backup") : mongoose.model("guild-backup", Schema);

module.exports = {
  model: Model,
  MAX_BACKUPS_PER_GUILD,

  createBackup: (data) => Model.create(data),

  getBackup: (guildId, backupId) => Model.findOne({ guild_id: guildId, backup_id: backupId }).lean(),

  listBackups: (guildId) => Model.find({ guild_id: guildId }).sort({ created_at: -1 }).lean(),

  countBackups: (guildId) => Model.countDocuments({ guild_id: guildId }),

  deleteBackup: (guildId, backupId) => Model.deleteOne({ guild_id: guildId, backup_id: backupId }),

  /**
   * Drop the oldest snapshots so a guild keeps at most `keep` of them.
   * @param {string} guildId
   * @param {number} keep
   */
  pruneBackups: async (guildId, keep = MAX_BACKUPS_PER_GUILD) => {
    const backups = await Model.find({ guild_id: guildId }).sort({ created_at: -1 }).skip(keep).select("_id").lean();
    if (backups.length === 0) return 0;

    const result = await Model.deleteMany({ _id: { $in: backups.map((doc) => doc._id) } });
    return result.deletedCount || 0;
  },

  deleteGuildBackups: (guildId) => Model.deleteMany({ guild_id: guildId }),
};
