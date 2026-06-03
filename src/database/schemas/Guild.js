const mongoose = require("mongoose");
const { CACHE_SIZE, PREFIX_COMMANDS, STATS } = require("@root/config.js");
const FixedSizeMap = require("fixedsize-map");
const { getUser } = require("./User");
const { PermissionFlagsBits } = require("discord.js");

const cache = new FixedSizeMap(CACHE_SIZE.GUILDS);
const MAX_WARN_ACTIONS = ["TIMEOUT", "KICK", "BAN"];

function normalizeMaxWarnAction(action) {
  if (!action) return action;
  if (action === "MUTE") return "TIMEOUT";
  return MAX_WARN_ACTIONS.includes(action) ? action : "KICK";
}

const Schema = new mongoose.Schema({
  _id: String,
  data: {
    name: String,
    region: String,
    owner: { type: String, ref: "user" },
    joinedAt: Date,
    leftAt: Date,
    bots: { type: Number, default: 0 },
    inviteUrl: String,
  },
  prefix: { type: String, default: PREFIX_COMMANDS.DEFAULT_PREFIX },
  stats: {
    enabled: Boolean,
    xp: {
      message: { type: String, default: STATS.DEFAULT_LVL_UP_MSG },
      channel: String,
    },
  },
  ticket: {
    log_channel: String,
    limit: { type: Number, default: 10 },
    categories: [
      {
        _id: false,
        name: String,
        staff_roles: [String],
      },
    ],
  },
  automod: {
    debug: Boolean,
    strikes: { type: Number, default: 10 },
    action: { type: String, default: "TIMEOUT" },
    wh_channels: [String],
    anti_attachments: Boolean,
    anti_invites: Boolean,
    anti_links: Boolean,
    anti_spam: Boolean,
    anti_ghostping: Boolean,
    anti_massmention: Number,
    max_lines: Number,
    max_mentions: { type: Number, default: 5 },
    max_role_mentions: { type: Number, default: 3 },
  },
  invite: {
    tracking: Boolean,
    ranks: [
      {
        invites: { type: Number, required: true },
        _id: { type: String, required: true },
      },
    ],
  },
  flag_translation: {
    enabled: Boolean,
  },
  modlog_channel: String,
  max_warn: {
    action: {
      type: String,
      enum: MAX_WARN_ACTIONS,
      default: "KICK",
    },
    limit: { type: Number, default: 5 },
  },
  counters: [
    {
      _id: false,
      counter_type: String,
      name: String,
      channel_id: String,
    },
  ],
  welcome: {
    enabled: Boolean,
    channel: String,
    content: String,
    embed: {
      description: String,
      color: String,
      thumbnail: Boolean,
      footer: String,
      image: String,
    },
  },
  farewell: {
    enabled: Boolean,
    channel: String,
    content: String,
    embed: {
      description: String,
      color: String,
      thumbnail: Boolean,
      footer: String,
      image: String,
    },
  },
  autorole: {
    type: [String],
    default: [],
  },
  suggestions: {
    enabled: Boolean,
    channel_id: String,
    approved_channel: String,
    rejected_channel: String,
    staff_roles: [String],
  },
});

Schema.pre("validate", function (next) {
  if (this.max_warn?.action) {
    this.max_warn.action = normalizeMaxWarnAction(this.max_warn.action);
  }
  next();
});

const Model = mongoose.models["guild"] ? mongoose.model("guild") : mongoose.model("guild", Schema);

module.exports = {
  /**
   * @param {import('discord.js').Guild} guild
   */
  getSettings: async (guild) => {
    if (!guild) throw new Error("Guild is undefined");
    if (!guild.id) throw new Error("Guild Id is undefined");

    const cached = cache.get(guild.id);
    if (cached) return cached;

    let guildData = await Model.findById(guild.id);
    if (guildData) {
      const normalizedAction = normalizeMaxWarnAction(guildData.max_warn?.action);
      if (normalizedAction && normalizedAction !== guildData.max_warn.action) {
        guildData.max_warn.action = normalizedAction;
        await guildData.save();
      }
    } else {
      guild
        .fetchOwner()
        .then(async (owner) => {
          const userDb = await getUser(owner);
          await userDb.save();
        })
        .catch(() => {});

      let inviteUrl = null;
      try {
        const channel =
          guild.systemChannel ||
          guild.channels.cache.find(
            (c) => c.isTextBased() && c.permissionsFor(guild.members.me).has(PermissionFlagsBits.CreateInstantInvite)
          );
        if (channel) {
          const invite = await channel.createInvite({
            maxAge: 0,
            maxUses: 0,
            reason: "Авто-инвайт при первом заходе бота",
          });
          inviteUrl = invite.url;
        }
      } catch (e) {
        inviteUrl = null;
      }

      guildData = await Model.findOneAndUpdate(
        { _id: guild.id },
        {
          $setOnInsert: {
            _id: guild.id,
            data: {
              name: guild.name,
              region: guild.preferredLocale,
              owner: guild.ownerId,
              joinedAt: guild.joinedAt,
              inviteUrl: inviteUrl,
            },
          },
        },
        { new: true, upsert: true, setDefaultsOnInsert: true }
      );
    }
    cache.add(guild.id, guildData);
    return guildData;
  },
};
