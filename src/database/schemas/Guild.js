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
  // null follows the server's own Discord locale; a value pins every message to it.
  language: { type: String, enum: ["ru", "en", null], default: null },
  stats: {
    enabled: Boolean,
    xp: {
      message: { type: String, default: STATS.DEFAULT_LVL_UP_MSG },
      channel: String,
      cooldown_seconds: { type: Number, default: 60, min: 0, max: 3600 },
      min_per_message: { type: Number, default: 1, min: 0, max: 1000 },
      max_per_message: { type: Number, default: 19, min: 0, max: 1000 },
      level_multiplier: { type: Number, default: 100, min: 10, max: 10000 },
    },
  },
  ticket: {
    log_channel: String,
    limit: { type: Number, default: 10 },
    staff_roles: { type: [String], default: [] },
    // The "open a ticket" message, so the panel can be moved or refreshed.
    panel_channel_id: String,
    panel_message_id: String,
    panel_title: { type: String, default: "Support Ticket", maxlength: 100 },
    panel_description: {
      type: String,
      default: "Please click the button below to create a ticket",
      maxlength: 1000,
    },
    category_timeout_seconds: { type: Number, default: 60, min: 15, max: 300 },
    channel_name_template: { type: String, default: "tіcket-{number}", maxlength: 100 },
    opening_message: {
      type: String,
      default: "Hello {member}\nSupport will be with you shortly\n{category}",
      maxlength: 1000,
    },
    close_button_label: { type: String, default: "Close Ticket", maxlength: 80 },
    categories: [
      {
        _id: false,
        name: String,
        staff_roles: [String],
        notification_channel: String,
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
    spam_whitelist_users: {
      type: [String],
      default: [],
    },
    spam_whitelist_roles: {
      type: [String],
      default: [],
    },
    spam_window_seconds: { type: Number, default: 3, min: 1, max: 300 },
    spam_max_repeats: { type: Number, default: 2, min: 2, max: 20 },
    filter_enabled: { type: Boolean, default: false },
    filter_terms: { type: String, default: "", maxlength: 4000 },
    filter_exceptions: { type: String, default: "", maxlength: 4000 },
    filter_match_mode: { type: String, enum: ["CONTAINS", "WORD", "EXACT"], default: "CONTAINS" },
    filter_case_sensitive: { type: Boolean, default: false },
    filter_delete: { type: Boolean, default: true },
    filter_strikes: { type: Number, default: 1, min: 0, max: 10 },
    link_mode: { type: String, enum: ["ALL", "ALLOWLIST", "BLOCKLIST"], default: "ALL" },
    link_domains: { type: String, default: "", maxlength: 4000 },
    allowed_invite_codes: { type: String, default: "", maxlength: 4000 },
    anti_image_spam: { type: Boolean, default: false },
    image_spam_threshold: { type: Number, default: 70, min: 50, max: 100 },
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
    cooldown_seconds: { type: Number, default: 120, min: 0, max: 3600 },
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
  restore_roles: {
    enabled: { type: Boolean, default: false },
    retention_days: { type: Number, default: 90, min: 1, max: 365 },
    // Roles carrying moderation power are not handed back automatically.
    include_privileged: { type: Boolean, default: false },
  },
  voice_roles: {
    enabled: { type: Boolean, default: false },
    // Given while the member sits in any voice channel.
    default_role: String,
    channels: [
      {
        _id: false,
        channel_id: String,
        role_id: String,
      },
    ],
  },
  temp_voice: {
    enabled: { type: Boolean, default: false },
    // Joining this channel hands the member a channel of their own.
    hub_channel_id: String,
    // Where those channels are created; defaults to the hub's own category.
    category_id: String,
    // Text channel holding the button panel, and the panel message itself.
    panel_channel_id: String,
    panel_message_id: String,
    // {user} and {count} are substituted when a channel is created.
    name_template: { type: String, default: "{user}", maxlength: 100 },
    default_limit: { type: Number, default: 0, min: 0, max: 99 },
    // Newly created channels start locked to everyone but their owner.
    default_locked: { type: Boolean, default: false },
    // How many channels one member may own at a time.
    max_per_member: { type: Number, default: 1, min: 1, max: 5 },
    // Hand the channel to somebody still inside instead of deleting it when the
    // owner leaves.
    claimable: { type: Boolean, default: true },
  },
  branding: {
    // Lets a server give the bot its own look without a separate application.
    name: { type: String, default: null, maxlength: 60 },
    color: { type: String, default: null },
    footer: { type: String, default: null, maxlength: 120 },
    iconURL: { type: String, default: null },
  },
  modmail: {
    enabled: { type: Boolean, default: false },
    // Private threads are created under this text channel.
    channel_id: String,
    staff_roles: { type: [String], default: [] },
    // Hide the responding staff member's name from the member.
    anonymous: { type: Boolean, default: false },
    // Forward every staff message in the thread; a leading dot keeps it internal.
    mirror_replies: { type: Boolean, default: true },
    thread_name_template: { type: String, default: "{username}-{id4}", maxlength: 100 },
    internal_note_prefix: { type: String, default: ".", maxlength: 10 },
    mention_staff: { type: Boolean, default: true },
  },
  verification: {
    enabled: { type: Boolean, default: false },
    // BUTTON grants the role on click; CAPTCHA asks for a code from an image first.
    mode: { type: String, enum: ["BUTTON", "CAPTCHA"], default: "BUTTON" },
    channel_id: String,
    message_id: String,
    role_id: String,
    // Usually an "Unverified" role that gates the rest of the server.
    remove_role_id: String,
    log_channel: String,
    title: { type: String, default: "Verification" },
    description: { type: String, default: "", maxlength: 1000 },
    button_label: { type: String, default: "Verify" },
    color: { type: String, default: null },
    captcha_length: { type: Number, default: 6, min: 4, max: 8 },
    challenge_ttl_minutes: { type: Number, default: 10, min: 1, max: 60 },
    max_tries: { type: Number, default: 3, min: 1, max: 10 },
  },
  birthdays: {
    enabled: { type: Boolean, default: false },
    channel_id: String,
    message: { type: String, default: "🎉 Happy birthday {member}!", maxlength: 1000 },
    // Role handed out for the day.
    role_id: String,
    color: { type: String, default: null },
    // Local announcement hour and the guild's offset from UTC.
    hour: { type: Number, default: 9, min: 0, max: 23 },
    utc_offset: { type: Number, default: 0, min: -12, max: 14 },
    role_duration_hours: { type: Number, default: 24, min: 1, max: 168 },
  },
  starboard: {
    enabled: { type: Boolean, default: false },
    channel_id: String,
    emoji: { type: String, default: "⭐" },
    threshold: { type: Number, default: 3, min: 1, max: 100 },
    // Whether the author's own star counts towards the threshold.
    self_star: { type: Boolean, default: true },
    allow_bots: { type: Boolean, default: false },
    // Remove the mirrored message when the count drops back below the threshold.
    remove_below: { type: Boolean, default: true },
    ignored_channels: { type: [String], default: [] },
    color: { type: String, default: null },
  },
  suggestions: {
    enabled: Boolean,
    channel_id: String,
    approved_channel: String,
    rejected_channel: String,
    staff_roles: [String],
  },
  ai: {
    enabled: { type: Boolean, default: false },
    automod_enabled: { type: Boolean, default: false },
    automod_mode: {
      type: String,
      enum: ["SHADOW", "ENFORCE"],
      default: "SHADOW",
    },
    automod_threshold: { type: Number, min: 50, max: 100, default: 85 },
    ticket_summaries: { type: Boolean, default: false },
    knowledge_enabled: { type: Boolean, default: false },
    knowledge: { type: String, default: "", maxlength: 12000 },
    suggestion_analysis: { type: Boolean, default: false },
    form_analysis: { type: Boolean, default: false },
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
  model: Model,
  cache,

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
