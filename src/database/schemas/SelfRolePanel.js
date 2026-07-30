const mongoose = require("mongoose");

// Discord caps a message at 5 action rows of 5 buttons, and a select menu at 25 options.
const MAX_PANEL_ROLES = 25;
const PANEL_STYLES = ["BUTTON", "SELECT"];

const Schema = new mongoose.Schema(
  {
    guild_id: { type: String, required: true },
    channel_id: { type: String, required: true },
    message_id: { type: String, required: true },
    name: { type: String, required: true },
    style: { type: String, enum: PANEL_STYLES, default: "BUTTON" },
    title: { type: String, default: "Self roles" },
    description: { type: String, default: "" },
    color: { type: String, default: null },
    placeholder: { type: String, default: "Pick your roles" },
    // 0 = unlimited. `unique` turns the panel into a radio group (colour roles).
    max_roles: { type: Number, default: 0, min: 0, max: MAX_PANEL_ROLES },
    unique: { type: Boolean, default: false },
    // When false a member can only add roles through the panel, never remove them.
    allow_remove: { type: Boolean, default: true },
    required_role: { type: String, default: null },
    roles: [
      {
        _id: false,
        role_id: { type: String, required: true },
        label: { type: String, required: true },
        emoji: { type: String, default: null },
        description: { type: String, default: null },
      },
    ],
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  }
);

Schema.index({ guild_id: 1, message_id: 1 }, { unique: true });
Schema.index({ guild_id: 1, name: 1 });

const Model = mongoose.models["self-role-panel"]
  ? mongoose.model("self-role-panel")
  : mongoose.model("self-role-panel", Schema);

// message_id -> panel. Button clicks must not wait on a database round trip.
const panelCache = new Map();

function cachePanel(panel) {
  if (panel) panelCache.set(panel.message_id, panel);
  return panel;
}

module.exports = {
  model: Model,
  MAX_PANEL_ROLES,
  PANEL_STYLES,

  cacheSelfRolePanels: async (client) => {
    panelCache.clear();
    const docs = await Model.find().lean();
    for (const doc of docs) {
      if (client && !client.guilds.cache.has(doc.guild_id)) continue;
      panelCache.set(doc.message_id, doc);
    }
    return panelCache.size;
  },

  getCachedPanel: (messageId) => panelCache.get(messageId),

  /**
   * @param {string} guildId
   * @param {string} messageId
   */
  getPanel: async (guildId, messageId) => {
    const cached = panelCache.get(messageId);
    if (cached && cached.guild_id === guildId) return cached;
    return cachePanel(await Model.findOne({ guild_id: guildId, message_id: messageId }).lean());
  },

  /**
   * Panels are addressed by message id or by the friendly name given at creation.
   * @param {string} guildId
   * @param {string} query
   */
  findPanel: async (guildId, query) => {
    if (!query) return null;
    const byMessage = await Model.findOne({ guild_id: guildId, message_id: query }).lean();
    if (byMessage) return cachePanel(byMessage);
    return cachePanel(
      await Model.findOne({ guild_id: guildId, name: new RegExp(`^${escapeRegex(query)}$`, "i") }).lean()
    );
  },

  listPanels: (guildId) => Model.find({ guild_id: guildId }).sort({ created_at: 1 }).lean(),

  createPanel: async (data) => cachePanel((await Model.create(data)).toObject()),

  /**
   * @param {string} guildId
   * @param {string} messageId
   * @param {object} update
   */
  updatePanel: async (guildId, messageId, update) =>
    cachePanel(
      await Model.findOneAndUpdate({ guild_id: guildId, message_id: messageId }, update, { new: true }).lean()
    ),

  deletePanel: async (guildId, messageId) => {
    await Model.deleteOne({ guild_id: guildId, message_id: messageId });
    panelCache.delete(messageId);
  },

  deleteGuildPanels: async (guildId) => {
    for (const [messageId, panel] of panelCache) {
      if (panel.guild_id === guildId) panelCache.delete(messageId);
    }
    await Model.deleteMany({ guild_id: guildId });
  },
};

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
