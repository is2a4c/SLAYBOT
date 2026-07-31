const mongoose = require("mongoose");
const FixedSizeMap = require("fixedsize-map");
const { CACHE_SIZE } = require("@root/config.js");

// Every click on the voice panel needs this record, so it is kept in memory: the
// document is the same object the handlers mutate and save, and it is dropped
// again the moment the channel goes away.
const cache = new FixedSizeMap(CACHE_SIZE.GUILDS);

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
  cache,

  /**
   * @param {{channelId: string, guildId: string, ownerId: string, locked?: boolean}} input
   */
  registerChannel: async ({ channelId, guildId, ownerId, locked = false }) => {
    const document = await Model.findOneAndUpdate(
      { _id: channelId },
      { $set: { guild_id: guildId, owner_id: ownerId, locked, trusted: [], blocked: [] } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    cache.add(channelId, document);
    return document;
  },

  /**
   * @param {string} channelId
   * @returns {Promise<object|null>}
   */
  getChannel: async (channelId) => {
    const cached = cache.get(channelId);
    if (cached) return cached;

    const document = await Model.findById(channelId);
    if (document) cache.add(channelId, document);
    return document;
  },

  listGuildChannels: (guildId) => Model.find({ guild_id: guildId }).lean(),

  countOwned: (guildId, ownerId) => Model.countDocuments({ guild_id: guildId, owner_id: ownerId }),

  deleteChannel: (channelId) => {
    cache.remove(channelId);
    return Model.deleteOne({ _id: channelId });
  },

  deleteGuildChannels: (guildId) => {
    // Guild-wide removals are rare, so dropping the whole cache is cheaper than
    // tracking which ids belonged to which guild.
    cache.clear();
    return Model.deleteMany({ guild_id: guildId });
  },

  /**
   * Drop rows whose Discord channel is already gone, so a restart does not leave
   * the collection describing channels nobody can join.
   *
   * @param {string} guildId
   * @param {string[]} aliveChannelIds
   */
  pruneMissing: (guildId, aliveChannelIds) => {
    cache.clear();
    return Model.deleteMany({ guild_id: guildId, _id: { $nin: aliveChannelIds } });
  },
};
