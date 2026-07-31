const mongoose = require("mongoose");

const Schema = new mongoose.Schema(
  {
    // The Discord voice channel id; a channel exists here only while it is alive.
    _id: String,
    guild_id: { type: String, required: true },
    owner_id: { type: String, required: true },
    // Members allowed in while the channel is locked or hidden.
    trusted: { type: [String], default: [] },
    // Members explicitly kept out, even if the channel is open.
    blocked: { type: [String], default: [] },
    locked: { type: Boolean, default: false },
    hidden: { type: Boolean, default: false },
    chat_locked: { type: Boolean, default: false },
  },
  { versionKey: false, timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

Schema.index({ guild_id: 1 });
Schema.index({ guild_id: 1, owner_id: 1 });

const Model = mongoose.models["temp-voice-channel"]
  ? mongoose.model("temp-voice-channel")
  : mongoose.model("temp-voice-channel", Schema);

module.exports = {
  model: Model,

  /**
   * @param {{channelId: string, guildId: string, ownerId: string, locked?: boolean}} input
   */
  registerChannel: ({ channelId, guildId, ownerId, locked = false }) =>
    Model.findOneAndUpdate(
      { _id: channelId },
      { $set: { guild_id: guildId, owner_id: ownerId, locked, trusted: [], blocked: [] } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ),

  getChannel: (channelId) => Model.findById(channelId),

  listGuildChannels: (guildId) => Model.find({ guild_id: guildId }).lean(),

  countOwned: (guildId, ownerId) => Model.countDocuments({ guild_id: guildId, owner_id: ownerId }),

  deleteChannel: (channelId) => Model.deleteOne({ _id: channelId }),

  deleteGuildChannels: (guildId) => Model.deleteMany({ guild_id: guildId }),

  /**
   * Drop rows whose Discord channel is already gone, so a restart does not leave
   * the collection describing channels nobody can join.
   *
   * @param {string} guildId
   * @param {string[]} aliveChannelIds
   */
  pruneMissing: (guildId, aliveChannelIds) => Model.deleteMany({ guild_id: guildId, _id: { $nin: aliveChannelIds } }),
};
