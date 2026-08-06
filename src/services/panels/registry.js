const { ButtonStyle, ChannelType } = require("discord.js");
const { defineConfigPanel } = require("./configPanel");
const publish = require("./publish");
const counters = require("./collections/counters");
const feeds = require("./collections/feeds");
const inviteRanks = require("./collections/inviteRanks");
const reactionRoles = require("./collections/reactionRoles");
const sticky = require("./collections/sticky");
const ticketCategories = require("./collections/ticketCategories");
const voiceChannels = require("./collections/voiceChannels");
const { slowRedraw } = require("./reply");
const { countFeeds } = require("@schemas/Feed");
const { listStickies } = require("@schemas/StickyMessage");
const { listGuildReactionRoles } = require("@schemas/ReactionRoles");

/**
 * Every configurable system, described as icons rather than as command options.
 *
 * A system appears here once and shows up everywhere: in the control hub, in its
 * own panel, and in the interaction router. Adding a setting is one line.
 */

const TEXT_CHANNELS = [ChannelType.GuildText, ChannelType.GuildAnnouncement];

/**
 * Discord throws when an embed is given a colour it cannot parse, which would
 * break the greeting at send time rather than here. A missing "#" is forgiven.
 *
 * @param {string} value
 */
function color(value) {
  const normalized = value.trim().replace(/^#?/, "#").toUpperCase();
  if (!/^#[0-9A-F]{6}$/.test(normalized)) return { ok: false, reason: "panels.common.badColor" };
  return { ok: true, value: normalized };
}

/**
 * @param {string} value
 */
function httpsUrl(value) {
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    return { ok: false, reason: "panels.common.badUrl" };
  }

  if (url.protocol !== "https:") return { ok: false, reason: "panels.common.badUrl" };
  return { ok: true, value: url.toString() };
}

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
const channelList = (id, emoji, key, channelTypes = TEXT_CHANNELS, max = 10) => ({
  id,
  emoji,
  key,
  type: "channelList",
  channelTypes,
  max,
  style: ButtonStyle.Primary,
});
const userList = (id, emoji, key, max = 10) => ({
  id,
  emoji,
  key,
  type: "userList",
  max,
  style: ButtonStyle.Primary,
});
const roleList = (id, emoji, key, max = 10) => ({
  id,
  emoji,
  key,
  type: "roleList",
  max,
  style: ButtonStyle.Primary,
});
/**
 * A button that opens another panel in the same message.
 *
 * Some things a system owns are a list rather than a setting — the categories of
 * a ticket, the channels of a voice role. They get their own screen, and this is
 * the way in, so the list is found where the system is rather than beside it.
 */
const opens = (id, emoji, target) => ({
  id,
  emoji,
  type: "action",
  run: (interaction, settings, t) => slowRedraw(interaction, () => PANELS[target].open(t, settings, interaction)),
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
const { HOME_ID } = require("./ids");

/**
 * Icons the hub uses for each system, and each system uses for itself.
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
  feeds: "📡",
  counters: "🔢",
  sticky: "📌",
  reactionroles: "🎭",
  voiceroles: "🔊",
  // Reached from the system they belong to rather than from the hub.
  ticketcategories: "🗂️",
  inviteranks: "🎁",
  voicechannels: "🔊",
};

/**
 * Whether a system is doing anything on a server right now.
 *
 * Most systems have their own switch; the ones that do not are running as soon as
 * the piece they cannot work without is in place. The hub sorts itself by this, so
 * what a server has turned on is answered before anything is clicked.
 */
const SYSTEM_ACTIVE = {
  // The basics — prefix, moderation log, warnings — always apply.
  server: () => true,
  tempvoice: (settings) => Boolean(settings?.temp_voice?.enabled),
  ticket: (settings) => Boolean(settings?.ticket?.panel_channel_id),
  verification: (settings) => Boolean(settings?.verification?.enabled),
  welcome: (settings) => Boolean(settings?.welcome?.enabled),
  farewell: (settings) => Boolean(settings?.farewell?.enabled),
  automod: (settings) => {
    const config = settings?.automod || {};
    const checks = [
      config.anti_invites,
      config.anti_links,
      config.anti_attachments,
      config.anti_spam,
      config.anti_image_spam,
      config.anti_ghostping,
    ];
    const limits = [config.anti_massmention, config.max_lines, config.max_mentions, config.max_role_mentions];
    return checks.some(Boolean) || limits.some((limit) => Number(limit) > 0);
  },
  starboard: (settings) => Boolean(settings?.starboard?.enabled),
  suggestions: (settings) => Boolean(settings?.suggestions?.enabled),
  modmail: (settings) => Boolean(settings?.modmail?.enabled),
  birthdays: (settings) => Boolean(settings?.birthdays?.enabled),
  ai: (settings) => Boolean(settings?.ai?.enabled),
  voiceroles: (settings) => Boolean(settings?.voice_roles?.enabled),
  // A list is running when the server has put something in it. These are the only
  // ones that have to ask the database, so the hub awaits them.
  counters: (settings) => (settings?.counters || []).length > 0,
  feeds: (settings, guild) => (guild ? countFeeds(guild.id).then((count) => count > 0) : false),
  sticky: (settings, guild) => (guild ? listStickies(guild.id).then((list) => list.length > 0) : false),
  reactionroles: (settings, guild) =>
    guild ? listGuildReactionRoles(guild.id).then((list) => list.length > 0) : false,
};

/**
 * @param {string} name system id, also its translation key
 * @param {string} path where its settings live in the guild document
 * @param {object[][]} rows
 */
function system(name, path, rows) {
  const panel = defineConfigPanel({
    id: `CFG_${name.toUpperCase()}`,
    titleKey: `panels.${name}.title`,
    icon: SYSTEM_ICONS[name],
    descriptionKey: `panels.${name}.description`,
    actionsKey: `panels.${name}.fields`,
    hintKey: "panels.common.hint",
    homeId: HOME_ID,
    path,
    rows,
  });

  return withHub(name, "settings", {
    ...panel,
    // Every panel opens the same way, whatever shape it has inside.
    open: (t, settings, interaction) => panel.build(t, settings, interaction.client),
  });
}

/**
 * What the hub needs from a panel, whichever kind it is.
 *
 * `kind` says what is inside: "settings" is one screen of values kept on the
 * guild document, "collection" is a list of entries with their own screens.
 *
 * @param {string} name
 * @param {"settings"|"collection"} kind
 * @param {object} panel
 */
function withHub(name, kind, panel) {
  return {
    ...panel,
    kind,
    icon: SYSTEM_ICONS[name],
    isActive: (settings, guild) => SYSTEM_ACTIVE[name]?.(settings, guild) || false,
  };
}

const PANELS = {
  server: system("server", "", [
    [
      text("prefix", "❗", "prefix", { maxLength: 5, example: "!" }),
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
    [
      choice("language", "🗣️", "language", ["ru", "en"], "panels.choices.language"),
      toggle("restorePrivileged", "🔑", "restore_roles.include_privileged"),
      channel("levelup", "🏅", "stats.xp.channel"),
      text("levelupMessage", "💬", "stats.xp.message", { long: true, maxLength: 500, required: false }),
      opens("inviteRanks", "🎁", "inviteranks"),
    ],
    // The bot's own look on this server: set by command until now, and read by
    // every embed the panel draws.
    [
      text("brandName", "🏷️", "branding.name", { maxLength: 60, required: false }),
      text("brandColor", "🎨", "branding.color", {
        maxLength: 7,
        required: false,
        validate: color,
        example: "#A855F7",
      }),
      text("brandFooter", "🔻", "branding.footer", { maxLength: 120, required: false }),
      text("brandIcon", "🖼️", "branding.iconURL", {
        maxLength: 300,
        required: false,
        validate: httpsUrl,
        example: "https://example.com/icon.png",
      }),
    ],
  ]),

  tempvoice: system("tempvoice", "temp_voice", [
    [
      toggle("enabled", "🔘", "enabled"),
      channel("hub", "🎙️", "hub_channel_id", [ChannelType.GuildVoice]),
      channel("category", "📂", "category_id", [ChannelType.GuildCategory]),
      text("template", "✏️", "name_template", { maxLength: 100, example: "{user} · {count}" }),
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
    [
      channel("panel", "📮", "panel_channel_id", TEXT_CHANNELS, { after: publish.ticketPanel }),
      opens("categories", "🗂️", "ticketcategories"),
    ],
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
    [text("color", "🎨", "color", { maxLength: 7, required: false, validate: color, example: "#A855F7" })],
  ]),

  welcome: system("welcome", "welcome", [
    [
      toggle("enabled", "🔘", "enabled"),
      channel("channel", "📢", "channel"),
      text("content", "💬", "content", {
        long: true,
        maxLength: 1000,
        required: false,
        example: "{member:mention} · {server} · {count}",
      }),
      text("description", "📝", "embed.description", { long: true, maxLength: 1000, required: false }),
      text("color", "🎨", "embed.color", { maxLength: 7, required: false, validate: color, example: "#A855F7" }),
    ],
    [
      text("footer", "🔻", "embed.footer", { maxLength: 200, required: false }),
      toggle("thumbnail", "🖼️", "embed.thumbnail"),
      text("image", "🏞️", "embed.image", {
        maxLength: 300,
        required: false,
        validate: httpsUrl,
        example: "https://example.com/banner.png",
      }),
    ],
  ]),

  farewell: system("farewell", "farewell", [
    [
      toggle("enabled", "🔘", "enabled"),
      channel("channel", "📢", "channel"),
      text("content", "💬", "content", {
        long: true,
        maxLength: 1000,
        required: false,
        example: "{member:mention} · {server} · {count}",
      }),
      text("description", "📝", "embed.description", { long: true, maxLength: 1000, required: false }),
      text("color", "🎨", "embed.color", { maxLength: 7, required: false, validate: color, example: "#A855F7" }),
    ],
    [
      text("footer", "🔻", "embed.footer", { maxLength: 200, required: false }),
      toggle("thumbnail", "🖼️", "embed.thumbnail"),
      text("image", "🏞️", "embed.image", {
        maxLength: 300,
        required: false,
        validate: httpsUrl,
        example: "https://example.com/banner.png",
      }),
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
      channelList("whitelistChannels", "🕊️", "wh_channels"),
    ],
    [
      roleList("whitelistRoles", "🎫", "spam_whitelist_roles"),
      userList("whitelistUsers", "🙋", "spam_whitelist_users"),
    ],
  ]),

  starboard: system("starboard", "starboard", [
    [
      toggle("enabled", "🔘", "enabled"),
      channel("channel", "⭐", "channel_id"),
      text("emoji", "😀", "emoji", { maxLength: 32, example: "⭐" }),
      number("threshold", "🔢", "threshold", 1, 100),
      toggle("selfStar", "🙋", "self_star"),
    ],
    [
      toggle("bots", "🤖", "allow_bots"),
      toggle("removeBelow", "🧹", "remove_below"),
      channelList("ignored", "🚫", "ignored_channels"),
      text("color", "🎨", "color", { maxLength: 7, required: false, validate: color, example: "#A855F7" }),
    ],
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
      text("message", "💬", "message", { long: true, maxLength: 1000, example: "🎉 {member} · {server}" }),
      role("role", "🎂", "role_id"),
      number("hour", "🕘", "hour", 0, 23),
    ],
    [
      number("offset", "🌍", "utc_offset", -12, 14),
      text("color", "🎨", "color", { maxLength: 7, required: false, validate: color, example: "#A855F7" }),
    ],
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

  voiceroles: system("voiceroles", "voice_roles", [
    [
      toggle("enabled", "🔘", "enabled"),
      role("defaultRole", "🎭", "default_role"),
      opens("channels", "🔊", "voicechannels"),
    ],
  ]),

  // Systems a server has several of, each with its own list.
  feeds: withHub("feeds", "collection", feeds),
  counters: withHub("counters", "collection", counters),
  sticky: withHub("sticky", "collection", sticky),
  reactionroles: withHub("reactionroles", "collection", reactionRoles),

  // Lists that belong to a system rather than standing beside it: the hub does
  // not offer them, the system they are part of does.
  ticketcategories: { ...withHub("ticketcategories", "collection", ticketCategories), hidden: true },
  inviteranks: { ...withHub("inviteranks", "collection", inviteRanks), hidden: true },
  voicechannels: { ...withHub("voicechannels", "collection", voiceChannels), hidden: true },
};

/**
 * Every panel the router has to know about, in the order they were declared.
 */
const SYSTEM_IDS = Object.keys(PANELS);

/**
 * What the hub offers.
 *
 * A panel reached from inside another one — the categories of a ticket, the
 * channels of a voice role — is routed like any other, but listing it beside the
 * system it belongs to would say there are two of them.
 */
const HUB_IDS = SYSTEM_IDS.filter((name) => !PANELS[name].hidden);

/** Systems that are one screen of settings on the guild document. */
const SETTINGS_IDS = SYSTEM_IDS.filter((name) => PANELS[name].kind === "settings");

/** Systems that are a list of entries. */
const COLLECTION_IDS = SYSTEM_IDS.filter((name) => PANELS[name].kind === "collection");

module.exports = { COLLECTION_IDS, HOME_ID, HUB_IDS, PANELS, SETTINGS_IDS, SYSTEM_ACTIVE, SYSTEM_ICONS, SYSTEM_IDS };
