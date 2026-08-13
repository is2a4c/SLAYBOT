const SNOWFLAKE = /^\d{17,20}$/;

const text = (id, path, maxLength = 1000, extra = {}) => ({ id, path, type: "text", maxLength, ...extra });
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
      text("welcomeDescription", "welcome.embed.description", 1000, { multiline: true, nullable: true }),
      text("welcomeColor", "welcome.embed.color", 7, { nullable: true, format: "color" }),
      toggle("welcomeThumbnail", "welcome.embed.thumbnail"),
      text("welcomeFooter", "welcome.embed.footer", 200, { nullable: true }),
      text("welcomeImage", "welcome.embed.image", 300, { nullable: true, format: "https" }),
      text("farewellDescription", "farewell.embed.description", 1000, { multiline: true, nullable: true }),
      text("farewellColor", "farewell.embed.color", 7, { nullable: true, format: "color" }),
      toggle("farewellThumbnail", "farewell.embed.thumbnail"),
      text("farewellFooter", "farewell.embed.footer", 200, { nullable: true }),
      text("farewellImage", "farewell.embed.image", 300, { nullable: true, format: "https" }),
    ],
  },
  {
    id: "ticket",
    fields: [
      channel("ticketLog", "ticket.log_channel"),
      number("ticketLimit", "ticket.limit", 1, 100),
      roleList("ticketStaff", "ticket.staff_roles"),
      text("ticketTitle", "ticket.panel_title", 100),
      text("ticketDescription", "ticket.panel_description", 1000, { multiline: true, nullable: true }),
      number("ticketCategoryTimeout", "ticket.category_timeout_seconds", 15, 300),
      text("ticketChannelTemplate", "ticket.channel_name_template", 100),
      text("ticketOpeningMessage", "ticket.opening_message", 1000, { multiline: true }),
      text("ticketCloseLabel", "ticket.close_button_label", 80),
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
    ],
  },
  {
    id: "suggestions",
    fields: [
      channel("suggestionsApproved", "suggestions.approved_channel"),
      channel("suggestionsRejected", "suggestions.rejected_channel"),
      roleList("suggestionsStaff", "suggestions.staff_roles"),
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
    id: "ai",
    fields: [
      toggle("aiEnabled", "ai.enabled"),
      toggle("aiAutomod", "ai.automod_enabled"),
      choice("aiMode", "ai.automod_mode", ["SHADOW", "ENFORCE"]),
      number("aiThreshold", "ai.automod_threshold", 50, 100),
      toggle("aiTickets", "ai.ticket_summaries"),
      toggle("aiKnowledge", "ai.knowledge_enabled"),
      text("aiKnowledgeText", "ai.knowledge", 12000, { multiline: true, nullable: true }),
      toggle("aiSuggestions", "ai.suggestion_analysis"),
      toggle("aiForms", "ai.form_analysis"),
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

function fieldsForView(settings) {
  return ADVANCED_SECTIONS.map((section) => ({
    ...section,
    fields: section.fields.map((field) => ({ ...field, value: getPath(settings, field.path) })),
  }));
}

module.exports = { ADVANCED_FIELDS, ADVANCED_SECTIONS, buildAdvancedPatch, fieldsForView, getPath };
