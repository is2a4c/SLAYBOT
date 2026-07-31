const { ButtonStyle, ChannelType } = require("discord.js");
const { defineConfigPanel } = require("./configPanel");
const publish = require("./publish");

/**
 * Every configurable system, described as icons rather than as command options.
 *
 * A system appears here once and shows up everywhere: in the control hub, in its
 * own panel, and in the interaction router. Adding a setting is one line.
 */

const TEXT_CHANNELS = [ChannelType.GuildText, ChannelType.GuildAnnouncement];

const toggle = (id, emoji, key) => ({ id, emoji, key, type: "toggle", style: ButtonStyle.Secondary });
const text = (id, emoji, key, options = {}) => ({
  id,
  emoji,
  key,
  type: "text",
  style: ButtonStyle.Secondary,
  ...options,
});
const number = (id, emoji, key, min, max) => ({
  id,
  emoji,
  key,
  type: "number",
  min,
  max,
  style: ButtonStyle.Secondary,
});
const channel = (id, emoji, key, channelTypes = TEXT_CHANNELS, extra = {}) => ({
  id,
  emoji,
  key,
  type: "channel",
  channelTypes,
  style: ButtonStyle.Primary,
  ...extra,
});
const role = (id, emoji, key) => ({ id, emoji, key, type: "role", style: ButtonStyle.Primary });
const roleList = (id, emoji, key, max = 10) => ({
  id,
  emoji,
  key,
  type: "roleList",
  max,
  style: ButtonStyle.Primary,
});
const choice = (id, emoji, key, choices, choicesKey) => ({
  id,
  emoji,
  key,
  type: "choice",
  choices,
  choicesKey,
  style: ButtonStyle.Secondary,
});

// Every system panel keeps a way back to the hub, whatever it redraws into.
const HOME_ID = "PANELHUB:home";

/**
 * @param {string} name system id, also its translation key
 * @param {string} path where its settings live in the guild document
 * @param {object[][]} rows
 */
function system(name, path, rows) {
  return defineConfigPanel({
    id: `CFG_${name.toUpperCase()}`,
    titleKey: `panels.${name}.title`,
    descriptionKey: `panels.${name}.description`,
    actionsKey: `panels.${name}.fields`,
    hintKey: "panels.common.hint",
    homeId: HOME_ID,
    path,
    rows,
  });
}

const PANELS = {
  server: system("server", "", [
    [
      text("prefix", "❗", "prefix", { maxLength: 5 }),
      channel("modlog", "📜", "modlog_channel"),
      roleList("autorole", "🎭", "autorole"),
      toggle("stats", "📈", "stats.enabled"),
      toggle("invites", "📨", "invite.tracking"),
    ],
    [
      toggle("flags", "🌐", "flag_translation.enabled"),
      number("warnlimit", "⚠️", "max_warn.limit", 1, 20),
      choice("warnaction", "⚖️", "max_warn.action", ["TIMEOUT", "KICK", "BAN"], "panels.choices.modAction"),
      toggle("restore", "♻️", "restore_roles.enabled"),
      number("retention", "🗓️", "restore_roles.retention_days", 1, 365),
    ],
  ]),

  tempvoice: system("tempvoice", "temp_voice", [
    [
      toggle("enabled", "🔘", "enabled"),
      channel("hub", "🎙️", "hub_channel_id", [ChannelType.GuildVoice]),
      channel("category", "📂", "category_id", [ChannelType.GuildCategory]),
      text("template", "✏️", "name_template", { maxLength: 100 }),
      number("limit", "🔢", "default_limit", 0, 99),
    ],
    [
      toggle("locked", "🔒", "default_locked"),
      number("perMember", "👤", "max_per_member", 1, 5),
      toggle("claimable", "👑", "claimable"),
      channel("panel", "📮", "panel_channel_id", TEXT_CHANNELS, { after: publish.tempVoicePanel }),
    ],
  ]),

  ticket: system("ticket", "ticket", [
    [
      channel("log", "📋", "log_channel"),
      number("limit", "🔢", "limit", 1, 100),
      roleList("staff", "👥", "staff_roles"),
      text("title", "✏️", "panel_title", { maxLength: 100 }),
      text("description", "📝", "panel_description", { long: true, maxLength: 1000, required: false }),
    ],
    [channel("panel", "📮", "panel_channel_id", TEXT_CHANNELS, { after: publish.ticketPanel })],
  ]),

  verification: system("verification", "verification", [
    [
      toggle("enabled", "🔘", "enabled"),
      choice("mode", "🎛️", "mode", ["BUTTON", "CAPTCHA"], "panels.choices.verificationMode"),
      role("role", "✅", "role_id"),
      role("removeRole", "➖", "remove_role_id"),
      channel("log", "📋", "log_channel"),
    ],
    [
      number("captcha", "🔠", "captcha_length", 4, 8),
      text("title", "✏️", "title", { maxLength: 100 }),
      text("description", "📝", "description", { long: true, maxLength: 1000, required: false }),
      text("button", "🔡", "button_label", { maxLength: 60 }),
      channel("panel", "📮", "channel_id", TEXT_CHANNELS, { after: publish.verificationPanel }),
    ],
  ]),

  welcome: system("welcome", "welcome", [
    [
      toggle("enabled", "🔘", "enabled"),
      channel("channel", "📢", "channel"),
      text("content", "💬", "content", { long: true, maxLength: 1000, required: false }),
      text("description", "📝", "embed.description", { long: true, maxLength: 1000, required: false }),
      text("color", "🎨", "embed.color", { maxLength: 7, required: false }),
    ],
    [
      text("footer", "🔻", "embed.footer", { maxLength: 200, required: false }),
      toggle("thumbnail", "🖼️", "embed.thumbnail"),
      text("image", "🏞️", "embed.image", { maxLength: 300, required: false }),
    ],
  ]),

  farewell: system("farewell", "farewell", [
    [
      toggle("enabled", "🔘", "enabled"),
      channel("channel", "📢", "channel"),
      text("content", "💬", "content", { long: true, maxLength: 1000, required: false }),
      text("description", "📝", "embed.description", { long: true, maxLength: 1000, required: false }),
      text("color", "🎨", "embed.color", { maxLength: 7, required: false }),
    ],
    [
      text("footer", "🔻", "embed.footer", { maxLength: 200, required: false }),
      toggle("thumbnail", "🖼️", "embed.thumbnail"),
      text("image", "🏞️", "embed.image", { maxLength: 300, required: false }),
    ],
  ]),

  automod: system("automod", "automod", [
    [
      number("strikes", "🔢", "strikes", 1, 100),
      choice("action", "⚖️", "action", ["TIMEOUT", "KICK", "BAN"], "panels.choices.modAction"),
      toggle("invites", "🔗", "anti_invites"),
      toggle("links", "🌐", "anti_links"),
      toggle("attachments", "📎", "anti_attachments"),
    ],
    [
      toggle("spam", "💬", "anti_spam"),
      toggle("imageSpam", "🖼️", "anti_image_spam"),
      number("imageThreshold", "🎚️", "image_spam_threshold", 50, 100),
      toggle("ghostping", "👻", "anti_ghostping"),
      number("massMention", "📣", "anti_massmention", 0, 50),
    ],
    [
      number("maxLines", "📏", "max_lines", 0, 100),
      number("maxMentions", "👤", "max_mentions", 0, 50),
      number("maxRoleMentions", "👥", "max_role_mentions", 0, 50),
      toggle("debug", "🐞", "debug"),
    ],
  ]),

  starboard: system("starboard", "starboard", [
    [
      toggle("enabled", "🔘", "enabled"),
      channel("channel", "⭐", "channel_id"),
      text("emoji", "😀", "emoji", { maxLength: 32 }),
      number("threshold", "🔢", "threshold", 1, 100),
      toggle("selfStar", "🙋", "self_star"),
    ],
    [toggle("bots", "🤖", "allow_bots"), toggle("removeBelow", "🧹", "remove_below")],
  ]),

  suggestions: system("suggestions", "suggestions", [
    [
      toggle("enabled", "🔘", "enabled"),
      channel("channel", "📝", "channel_id"),
      channel("approved", "✅", "approved_channel"),
      channel("rejected", "❌", "rejected_channel"),
      roleList("staff", "👥", "staff_roles"),
    ],
  ]),

  modmail: system("modmail", "modmail", [
    [
      toggle("enabled", "🔘", "enabled"),
      channel("channel", "📬", "channel_id"),
      roleList("staff", "👥", "staff_roles"),
      toggle("anonymous", "🕶️", "anonymous"),
      toggle("mirror", "🪞", "mirror_replies"),
    ],
  ]),

  birthdays: system("birthdays", "birthdays", [
    [
      toggle("enabled", "🔘", "enabled"),
      channel("channel", "🎉", "channel_id"),
      text("message", "💬", "message", { long: true, maxLength: 1000 }),
      role("role", "🎂", "role_id"),
      number("hour", "🕘", "hour", 0, 23),
    ],
    [number("offset", "🌍", "utc_offset", -12, 14), text("color", "🎨", "color", { maxLength: 7, required: false })],
  ]),

  ai: system("ai", "ai", [
    [
      toggle("enabled", "🔘", "enabled"),
      toggle("automod", "🛡️", "automod_enabled"),
      choice("mode", "🎛️", "automod_mode", ["SHADOW", "ENFORCE"], "panels.choices.aiMode"),
      number("threshold", "🎚️", "automod_threshold", 50, 100),
      toggle("tickets", "🎫", "ticket_summaries"),
    ],
    [
      toggle("knowledge", "📚", "knowledge_enabled"),
      text("knowledgeText", "📖", "knowledge", { long: true, maxLength: 4000, required: false }),
      toggle("suggestions", "📝", "suggestion_analysis"),
      toggle("forms", "🗒️", "form_analysis"),
    ],
  ]),
};

/**
 * The order systems appear in the hub.
 */
const SYSTEM_IDS = Object.keys(PANELS);

/**
 * Icons the hub uses for each system.
 */
const SYSTEM_ICONS = {
  server: "🛠️",
  tempvoice: "🎙️",
  ticket: "🎫",
  verification: "🛡️",
  welcome: "👋",
  farewell: "🚪",
  automod: "🤖",
  starboard: "⭐",
  suggestions: "📝",
  modmail: "📬",
  birthdays: "🎂",
  ai: "✨",
};

module.exports = { HOME_ID, PANELS, SYSTEM_ICONS, SYSTEM_IDS };
