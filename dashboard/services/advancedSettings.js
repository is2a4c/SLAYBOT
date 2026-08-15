const {
  RichMessageError,
  sanitizeButtons,
  sanitizeFields,
  stringifyButtons,
  stringifyFields,
} = require("@src/services/richMessage/RichMessage");

const SNOWFLAKE = /^\d{17,20}$/;

const text = (id, path, maxLength = 1000, extra = {}) => ({ id, path, type: "text", maxLength, ...extra });
// A compact list of {name, value, inline} or {label, url, emoji} rows, typed as
// one plain-text line each - the same shape and the same limits a custom
// command's message action uses, so "shared" means the same code, not a
// second implementation that quietly drifts from the first.
const richFields = (id, path, max) => ({ id, path, type: "richFields", max });
const richButtons = (id, path, max) => ({ id, path, type: "richButtons", max });
const number = (id, path, min, max) => ({ id, path, type: "number", min, max });
const toggle = (id, path) => ({ id, path, type: "toggle" });
const choice = (id, path, choices, extra = {}) => ({ id, path, type: "choice", choices, ...extra });
const channel = (id, path, channelKind = "text") => ({ id, path, type: "channel", channelKind });
const role = (id, path) => ({ id, path, type: "role" });
const roleList = (id, path, max = 25) => ({ id, path, type: "roleList", max });
const channelList = (id, path, channelKind = "text", max = 25) => ({
  id,
  path,
  type: "channelList",
  channelKind,
  max,
});

/**
 * Safe, immediately consumed guild settings. Collection editors stay in
 * Discord because they create or publish Discord objects rather than merely
 * changing configuration.
 */
const ADVANCED_SECTIONS = [
  {
    id: "server",
    fields: [
      choice("language", "language", ["ru", "en"], { nullable: true }),
      toggle("inviteTracking", "invite.tracking"),
      toggle("flagTranslation", "flag_translation.enabled"),
      channel("levelChannel", "stats.xp.channel"),
      text("levelMessage", "stats.xp.message", 500, { multiline: true }),
      number("xpCooldown", "stats.xp.cooldown_seconds", 0, 3600),
      number("xpMin", "stats.xp.min_per_message", 0, 1000),
      number("xpMax", "stats.xp.max_per_message", 0, 1000),
      number("xpMultiplier", "stats.xp.level_multiplier", 10, 10000),
      number("translationCooldown", "flag_translation.cooldown_seconds", 0, 3600),
      number("warnLimit", "max_warn.limit", 1, 20),
      choice("warnAction", "max_warn.action", ["TIMEOUT", "KICK", "BAN"]),
      toggle("restoreRoles", "restore_roles.enabled"),
      number("restoreDays", "restore_roles.retention_days", 1, 365),
      toggle("restorePrivileged", "restore_roles.include_privileged"),
      text("brandName", "branding.name", 60, { nullable: true }),
      text("brandColor", "branding.color", 7, { nullable: true, format: "color" }),
      text("brandFooter", "branding.footer", 120, { nullable: true }),
      text("brandIcon", "branding.iconURL", 300, { nullable: true, format: "https" }),
    ],
  },
  {
    id: "greetings",
    fields: [
      toggle("welcomeEnabled", "welcome.enabled"),
      channel("welcomeChannel", "welcome.channel"),
      text("welcomeContent", "welcome.content", 1000, { multiline: true, nullable: true }),
      toggle("welcomeBots", "welcome.allow_bots"),
      text("welcomeTitle", "welcome.embed.title", 256, { nullable: true }),
      text("welcomeAuthor", "welcome.embed.author", 256, { nullable: true }),
      text("welcomeDescription", "welcome.embed.description", 1000, { multiline: true, nullable: true }),
      text("welcomeColor", "welcome.embed.color", 7, { nullable: true, format: "color" }),
      toggle("welcomeThumbnail", "welcome.embed.thumbnail"),
      text("welcomeFooter", "welcome.embed.footer", 200, { nullable: true }),
      text("welcomeImage", "welcome.embed.image", 300, { nullable: true, format: "https" }),
      toggle("welcomeTimestamp", "welcome.embed.timestamp"),
      richFields("welcomeFields", "welcome.fields"),
      richButtons("welcomeButtons", "welcome.buttons"),
      toggle("farewellEnabled", "farewell.enabled"),
      channel("farewellChannel", "farewell.channel"),
      text("farewellContent", "farewell.content", 1000, { multiline: true, nullable: true }),
      toggle("farewellBots", "farewell.allow_bots"),
      text("farewellTitle", "farewell.embed.title", 256, { nullable: true }),
      text("farewellAuthor", "farewell.embed.author", 256, { nullable: true }),
      text("farewellDescription", "farewell.embed.description", 1000, { multiline: true, nullable: true }),
      text("farewellColor", "farewell.embed.color", 7, { nullable: true, format: "color" }),
      toggle("farewellThumbnail", "farewell.embed.thumbnail"),
      text("farewellFooter", "farewell.embed.footer", 200, { nullable: true }),
      text("farewellImage", "farewell.embed.image", 300, { nullable: true, format: "https" }),
      toggle("farewellTimestamp", "farewell.embed.timestamp"),
      richFields("farewellFields", "farewell.fields"),
      richButtons("farewellButtons", "farewell.buttons"),
    ],
  },
  {
    id: "ticket",
    fields: [
      channel("ticketLog", "ticket.log_channel"),
      number("ticketLimit", "ticket.limit", 1, 100),
      roleList("ticketStaff", "ticket.staff_roles"),
      channel("ticketPanelChannel", "ticket.panel_channel_id"),
      channel("ticketCategory", "ticket.category_id", "category"),
      text("ticketTitle", "ticket.panel_title", 100),
      text("ticketDescription", "ticket.panel_description", 1000, { multiline: true, nullable: true }),
      number("ticketCategoryTimeout", "ticket.category_timeout_seconds", 15, 300),
      text("ticketChannelTemplate", "ticket.channel_name_template", 100),
      text("ticketOpeningMessage", "ticket.opening_message", 1000, { multiline: true }),
      text("ticketOpeningColor", "ticket.opening_color", 7, { nullable: true, format: "color" }),
      text("ticketOpeningFooter", "ticket.opening_footer", 200, { nullable: true }),
      toggle("ticketPingMember", "ticket.ping_member"),
      toggle("ticketDmCreate", "ticket.dm_on_create"),
      toggle("ticketDmClose", "ticket.dm_on_close"),
      toggle("ticketTranscripts", "ticket.transcripts"),
      text("ticketCloseLabel", "ticket.close_button_label", 80),
      choice("ticketCloseStyle", "ticket.close_button_style", ["PRIMARY", "SECONDARY", "SUCCESS", "DANGER"]),
    ],
  },
  {
    id: "tempVoice",
    fields: [
      toggle("tempVoiceEnabled", "temp_voice.enabled"),
      channel("tempVoiceHub", "temp_voice.hub_channel_id", "voice"),
      channel("tempVoiceCategory", "temp_voice.category_id", "category"),
      text("tempVoiceTemplate", "temp_voice.name_template", 100),
      number("tempVoiceLimit", "temp_voice.default_limit", 0, 99),
      toggle("tempVoiceLocked", "temp_voice.default_locked"),
      number("tempVoicePerMember", "temp_voice.max_per_member", 1, 5),
      toggle("tempVoiceClaimable", "temp_voice.claimable"),
    ],
  },
  {
    id: "verification",
    fields: [
      toggle("verificationEnabled", "verification.enabled"),
      choice("verificationMode", "verification.mode", ["BUTTON", "CAPTCHA"]),
      channel("verificationChannel", "verification.channel_id"),
      role("verificationRole", "verification.role_id"),
      role("verificationRemoveRole", "verification.remove_role_id"),
      channel("verificationLog", "verification.log_channel"),
      text("verificationTitle", "verification.title", 100),
      text("verificationDescription", "verification.description", 1000, { multiline: true, nullable: true }),
      text("verificationButton", "verification.button_label", 60),
      text("verificationColor", "verification.color", 7, { nullable: true, format: "color" }),
      number("captchaLength", "verification.captcha_length", 4, 8),
      number("verificationTtl", "verification.challenge_ttl_minutes", 1, 60),
      number("verificationTries", "verification.max_tries", 1, 10),
    ],
  },
  {
    id: "starboard",
    fields: [
      toggle("starboardEnabled", "starboard.enabled"),
      channel("starboardChannel", "starboard.channel_id"),
      text("starboardEmoji", "starboard.emoji", 32),
      number("starboardThreshold", "starboard.threshold", 1, 100),
      toggle("starboardSelf", "starboard.self_star"),
      toggle("starboardBots", "starboard.allow_bots"),
      toggle("starboardRemove", "starboard.remove_below"),
      channelList("starboardIgnored", "starboard.ignored_channels"),
      text("starboardColor", "starboard.color", 7, { nullable: true, format: "color" }),
      toggle("starboardShowAuthor", "starboard.show_author"),
      toggle("starboardShowSource", "starboard.show_source"),
      toggle("starboardShowJump", "starboard.show_jump_link"),
      toggle("starboardShowImages", "starboard.show_images"),
      toggle("starboardShowAttachments", "starboard.show_attachments"),
      toggle("starboardShowTimestamp", "starboard.show_timestamp"),
      number("starboardContentLength", "starboard.content_length", 100, 3800),
    ],
  },
  {
    id: "suggestions",
    fields: [
      toggle("suggestionsEnabled", "suggestions.enabled"),
      channel("suggestionsChannel", "suggestions.channel_id"),
      channel("suggestionsApproved", "suggestions.approved_channel"),
      channel("suggestionsRejected", "suggestions.rejected_channel"),
      roleList("suggestionsStaff", "suggestions.staff_roles"),
      toggle("suggestionsAnonymous", "suggestions.anonymous"),
      toggle("suggestionsVoting", "suggestions.voting_enabled"),
      text("suggestionsUpvote", "suggestions.upvote_emoji", 100),
      text("suggestionsDownvote", "suggestions.downvote_emoji", 100),
      text("suggestionsDefaultColor", "suggestions.default_color", 7, { nullable: true, format: "color" }),
      text("suggestionsApprovedColor", "suggestions.approved_color", 7, { nullable: true, format: "color" }),
      text("suggestionsRejectedColor", "suggestions.rejected_color", 7, { nullable: true, format: "color" }),
      toggle("suggestionsMoveProcessed", "suggestions.move_processed"),
      text("suggestionsApproveLabel", "suggestions.approve_label", 80),
      text("suggestionsRejectLabel", "suggestions.reject_label", 80),
      text("suggestionsDeleteLabel", "suggestions.delete_label", 80),
    ],
  },
  {
    id: "modmail",
    fields: [
      toggle("modmailEnabled", "modmail.enabled"),
      channel("modmailChannel", "modmail.channel_id"),
      roleList("modmailStaff", "modmail.staff_roles"),
      toggle("modmailAnonymous", "modmail.anonymous"),
      toggle("modmailMirror", "modmail.mirror_replies"),
      text("modmailThreadTemplate", "modmail.thread_name_template", 100),
      text("modmailNotePrefix", "modmail.internal_note_prefix", 10, { nullable: true }),
      toggle("modmailMentionStaff", "modmail.mention_staff"),
      text("modmailIntro", "modmail.intro_message", 1000, { multiline: true }),
      text("modmailIntroColor", "modmail.intro_color", 7, { nullable: true, format: "color" }),
      text("modmailIncomingColor", "modmail.incoming_color", 7, { nullable: true, format: "color" }),
      text("modmailReplyColor", "modmail.reply_color", 7, { nullable: true, format: "color" }),
      toggle("modmailAttachments", "modmail.show_attachments"),
      text("modmailMemberAck", "modmail.member_ack_emoji", 100, { nullable: true }),
      text("modmailStaffAck", "modmail.staff_ack_emoji", 100, { nullable: true }),
      choice("modmailArchive", "modmail.archive_duration_minutes", ["60", "1440", "4320", "10080"]),
    ],
  },
  {
    id: "birthdays",
    fields: [
      toggle("birthdaysEnabled", "birthdays.enabled"),
      channel("birthdaysChannel", "birthdays.channel_id"),
      text("birthdaysMessage", "birthdays.message", 1000, { multiline: true }),
      role("birthdaysRole", "birthdays.role_id"),
      number("birthdaysHour", "birthdays.hour", 0, 23),
      number("birthdaysOffset", "birthdays.utc_offset", -12, 14),
      text("birthdaysColor", "birthdays.color", 7, { nullable: true, format: "color" }),
      number("birthdaysRoleDuration", "birthdays.role_duration_hours", 1, 168),
    ],
  },
  {
    id: "voiceRoles",
    fields: [toggle("voiceRolesEnabled", "voice_roles.enabled"), role("voiceRolesDefault", "voice_roles.default_role")],
  },
];

const ADVANCED_FIELDS = ADVANCED_SECTIONS.flatMap((section) => section.fields);

function getPath(target, path) {
  return path.split(".").reduce((value, key) => value?.[key], target);
}

function channelMatches(channel, kind) {
  if (!channel) return false;
  if (kind === "voice") return channel.type === 2;
  if (kind === "category") return channel.type === 4;
  return channel.isTextBased?.() && !channel.isThread?.();
}

function parseList(raw) {
  return String(raw || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function parseField(guild, body, field, current) {
  const raw = body[field.id];
  if (field.type === "toggle") return raw === "on";
  if (field.type === "richFields") {
    // Malformed input reverts to what was already stored, the same way every
    // other field here degrades - not a rejected form, just an ignored line.
    try {
      return sanitizeFields(raw, field.max);
    } catch (error) {
      if (error instanceof RichMessageError) return current;
      throw error;
    }
  }
  if (field.type === "richButtons") {
    try {
      return sanitizeButtons(raw, field.max);
    } catch (error) {
      if (error instanceof RichMessageError) return current;
      throw error;
    }
  }
  if (field.type === "number") {
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed)) return current;
    return Math.min(field.max, Math.max(field.min, parsed));
  }
  if (field.type === "choice") {
    if (field.nullable && !raw) return null;
    return field.choices.includes(raw) ? raw : current;
  }
  if (field.type === "channel") {
    if (!SNOWFLAKE.test(String(raw || ""))) return null;
    return channelMatches(guild.channels.cache.get(raw), field.channelKind) ? raw : null;
  }
  if (field.type === "role") return SNOWFLAKE.test(String(raw || "")) && guild.roles.cache.has(raw) ? raw : null;
  if (field.type === "roleList") {
    return [...new Set(parseList(raw).filter((id) => SNOWFLAKE.test(id) && guild.roles.cache.has(id)))].slice(
      0,
      field.max
    );
  }
  if (field.type === "channelList") {
    return [
      ...new Set(
        parseList(raw).filter(
          (id) => SNOWFLAKE.test(id) && channelMatches(guild.channels.cache.get(id), field.channelKind)
        )
      ),
    ].slice(0, field.max);
  }

  const value = String(raw || "")
    .trim()
    .slice(0, field.maxLength);
  if (!value && field.nullable) return null;
  if (field.format === "color")
    return /^#?[\dA-Fa-f]{6}$/.test(value) ? `#${value.replace(/^#/, "").toUpperCase()}` : current;
  if (field.format === "https") {
    try {
      const url = new URL(value);
      return url.protocol === "https:" ? url.toString() : current;
    } catch {
      return current;
    }
  }
  return value;
}

function buildAdvancedPatch(guild, body, settings) {
  return Object.fromEntries(
    ADVANCED_FIELDS.map((field) => [field.path, parseField(guild, body, field, getPath(settings, field.path))])
  );
}

function viewValue(field, settings) {
  const stored = getPath(settings, field.path);
  if (field.type === "richFields") return stringifyFields(stored);
  if (field.type === "richButtons") return stringifyButtons(stored);
  return stored;
}

function fieldsForView(settings) {
  return ADVANCED_SECTIONS.map((section) => ({
    ...section,
    fields: section.fields.map((field) => ({ ...field, value: viewValue(field, settings) })),
  }));
}

const TICKET_PANEL_PATHS = new Set([
  "ticket.panel_channel_id",
  "ticket.panel_title",
  "ticket.panel_description",
  "branding.name",
  "branding.color",
  "branding.footer",
  "branding.iconURL",
]);

function shouldRepublishTicketPanel(settings, patch) {
  const currentChannel = settings.ticket?.panel_channel_id || null;
  const nextChannel = Object.hasOwn(patch, "ticket.panel_channel_id")
    ? patch["ticket.panel_channel_id"]
    : currentChannel;
  if (!settings.ticket?.panel_message_id) return Boolean(nextChannel);

  return [...TICKET_PANEL_PATHS].some((path) => Object.hasOwn(patch, path) && getPath(settings, path) !== patch[path]);
}

module.exports = {
  ADVANCED_FIELDS,
  ADVANCED_SECTIONS,
  buildAdvancedPatch,
  fieldsForView,
  getPath,
  parseField,
  shouldRepublishTicketPanel,
};
