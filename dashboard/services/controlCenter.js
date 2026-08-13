const SNOWFLAKE = /^\d{17,20}$/;

const field = (id, path, type, extra = {}) => ({
  id,
  path,
  type,
  runtime: !path.startsWith("control_center."),
  ...extra,
});
const toggle = (id, path, extra = {}) => field(id, path, "toggle", extra);
const text = (id, path, maxLength = 1000, extra = {}) => field(id, path, "text", { maxLength, ...extra });
const number = (id, path, min, max, extra = {}) => field(id, path, "number", { min, max, ...extra });
const choice = (id, path, choices) => field(id, path, "choice", { choices });
const channel = (id, path, channelKind = "text", extra = {}) => field(id, path, "channel", { channelKind, ...extra });
const role = (id, path) => field(id, path, "role");
const roleList = (id, path, max = 25) => field(id, path, "roleList", { max });
const channelList = (id, path, channelKind = "text", max = 25) => field(id, path, "channelList", { channelKind, max });

const CONTROL_MODULES = [
  {
    id: "common",
    icon: "settings",
    groups: [
      {
        id: "identity",
        fields: [
          text("prefix", "prefix", 5),
          choice("language", "language", ["ru", "en", "DISCORD"]),
          text("timezone", "control_center.common.timezone", 64),
          toggle("slashCommands", "control_center.common.slash_commands"),
          toggle("textCommands", "control_center.common.text_commands", { runtime: true }),
          roleList("adminRoles", "control_center.common.admin_roles"),
        ],
      },
      {
        id: "onboarding",
        fields: [
          roleList("starterRoles", "autorole", 10),
          toggle("autoroleAlways", "control_center.common.autorole_always"),
          toggle("restoreRoles", "restore_roles.enabled"),
          toggle("restoreNickname", "control_center.common.restore_nickname"),
          number("restoreDays", "restore_roles.retention_days", 1, 365),
          toggle("restorePrivileged", "restore_roles.include_privileged"),
          toggle("voiceRolesEnabled", "voice_roles.enabled"),
          role("voiceDefaultRole", "voice_roles.default_role"),
        ],
      },
    ],
  },
  {
    id: "moderation",
    icon: "shield",
    groups: [
      {
        id: "team",
        fields: [
          roleList("moderatorRoles", "control_center.moderation.moderator_roles"),
          toggle("cooldownExempt", "control_center.moderation.cooldown_exempt"),
          toggle("roleHierarchy", "control_center.moderation.respect_role_hierarchy"),
          number("warningExpiry", "control_center.moderation.warning_expiry_days", 0, 3650),
          number("warningLimit", "max_warn.limit", 1, 100),
          choice("warningAction", "max_warn.action", ["TIMEOUT", "KICK", "BAN"]),
        ],
      },
      {
        id: "mute",
        fields: [
          choice("muteScope", "control_center.moderation.default_mute_scope", ["ALL", "TEXT", "VOICE"]),
          choice("muteMode", "control_center.moderation.mute_mode", ["TIMEOUT", "ROLE", "BOTH"]),
          role("muteRole", "control_center.moderation.mute_role"),
          channelList("muteExcluded", "control_center.moderation.mute_excluded_channels", "text"),
          toggle("blockReactions", "control_center.moderation.block_reactions"),
        ],
      },
      {
        id: "filters",
        fields: [
          toggle("antiCaps", "control_center.moderation.anti_caps"),
          number("capsPercent", "control_center.moderation.caps_percent", 10, 100),
          toggle("antiEmoji", "control_center.moderation.anti_emoji"),
          number("maxEmoji", "control_center.moderation.max_emoji", 1, 100),
          toggle("antiZalgo", "control_center.moderation.anti_zalgo"),
          toggle("repeatedText", "control_center.moderation.repeated_text"),
          toggle("antiLinks", "automod.anti_links"),
          toggle("antiInvites", "automod.anti_invites"),
          toggle("antiSpam", "automod.anti_spam"),
          toggle("antiImageSpam", "automod.anti_image_spam"),
        ],
      },
    ],
  },
  {
    id: "music",
    icon: "pulse",
    groups: [
      {
        id: "access",
        fields: [
          channel("musicChannel", "control_center.music.channel_id"),
          toggle("musicAnyChannel", "control_center.music.allow_any_channel"),
          roleList("djRoles", "control_center.music.dj_roles"),
          choice("musicSource", "control_center.music.default_source", ["YOUTUBE", "YANDEX", "SPOTIFY", "SOUNDCLOUD"]),
        ],
      },
      {
        id: "playback",
        fields: [
          toggle("compactQueue", "control_center.music.compact_queue"),
          toggle("deleteMusicNotices", "control_center.music.delete_notices"),
          toggle("progressBar", "control_center.music.progress_bar"),
          number("queueLimit", "control_center.music.max_queue_per_user", 1, 500),
          number("trackLimit", "control_center.music.max_track_minutes", 1, 1440),
        ],
      },
      {
        id: "autoplay",
        fields: [
          toggle("autoplay", "control_center.music.autoplay_enabled"),
          text("autoplayQuery", "control_center.music.autoplay_query", 500),
          channel("autoplayChannel", "control_center.music.autoplay_output_channel"),
        ],
      },
    ],
  },
  {
    id: "ranking",
    icon: "crown",
    groups: [
      {
        id: "textXp",
        fields: [
          toggle("rankingEnabled", "stats.enabled"),
          toggle("publicRanking", "control_center.ranking.public_page"),
          toggle("resetOnLeave", "control_center.ranking.reset_on_leave"),
          roleList("rankingIgnoredRoles", "control_center.ranking.ignored_roles"),
          channelList("rankingIgnoredText", "control_center.ranking.ignored_text_channels", "text"),
          number("xpCooldown", "stats.xp.cooldown_seconds", 0, 3600),
          number("xpMin", "stats.xp.min_per_message", 0, 1000),
          number("xpMax", "stats.xp.max_per_message", 0, 1000),
          number("textMultiplier", "control_center.ranking.text_multiplier", 0, 100, { step: "0.1" }),
          channel("levelChannel", "stats.xp.channel"),
          text("levelMessage", "stats.xp.message", 500, { multiline: true }),
        ],
      },
      {
        id: "voiceXp",
        fields: [
          toggle("voiceRanking", "control_center.ranking.voice_enabled"),
          channelList("rankingIgnoredVoice", "control_center.ranking.ignored_voice_channels", "voice"),
          number("voiceMultiplier", "control_center.ranking.voice_multiplier", 0, 100, { step: "0.1" }),
          number("rankingMaxMembers", "control_center.ranking.max_members", 100, 1000000),
        ],
      },
      {
        id: "card",
        fields: [
          text("rankCardAccent", "control_center.ranking.card_accent", 7, { format: "color" }),
          text("rankCardBackground", "control_center.ranking.card_background", 300, { format: "https" }),
        ],
      },
    ],
  },
  {
    id: "notifications",
    icon: "alert",
    groups: [
      {
        id: "members",
        fields: [
          toggle("welcomeEnabled", "welcome.enabled"),
          channel("welcomeChannel", "welcome.channel"),
          text("welcomeMessage", "welcome.content", 1000, { multiline: true }),
          toggle("welcomeDm", "control_center.notifications.welcome_dm", { runtime: true }),
          toggle("farewellEnabled", "farewell.enabled"),
          channel("farewellChannel", "farewell.channel"),
          text("farewellMessage", "farewell.content", 1000, { multiline: true }),
        ],
      },
      {
        id: "events",
        fields: [
          toggle("boostEnabled", "control_center.notifications.boost_enabled", { runtime: true }),
          channel("boostChannel", "control_center.notifications.boost_channel", "text", { runtime: true }),
          text("boostMessage", "control_center.notifications.boost_message", 1000, {
            multiline: true,
            runtime: true,
          }),
        ],
      },
      {
        id: "directMessages",
        fields: [
          toggle("dmBan", "control_center.notifications.dm_on_ban", { runtime: true }),
          toggle("dmKick", "control_center.notifications.dm_on_kick", { runtime: true }),
          toggle("dmMute", "control_center.notifications.dm_on_mute", { runtime: true }),
          toggle("dmWarn", "control_center.notifications.dm_on_warn", { runtime: true }),
        ],
      },
    ],
  },
  {
    id: "fun",
    icon: "grid",
    groups: [
      { id: "roulette", fields: [toggle("roulette", "control_center.fun.roulette_enabled")] },
      {
        id: "forestFuss",
        fields: [
          toggle("forestFuss", "control_center.fun.forest_fuss_enabled"),
          channel("fussCategory", "control_center.fun.category_id", "category"),
          number("fussSessions", "control_center.fun.max_sessions", 1, 20),
          number("fussPlayers", "control_center.fun.max_players", 4, 100),
          text("fussLobby", "control_center.fun.lobby_name", 100),
          text("fussWolves", "control_center.fun.wolves_name", 100),
          toggle("fussLeaders", "control_center.fun.leaders_only"),
          number("fussRecruitment", "control_center.fun.recruitment_seconds", 15, 3600),
          number("fussDay", "control_center.fun.day_seconds", 30, 3600),
          number("fussNight", "control_center.fun.night_seconds", 30, 3600),
          number("fussResults", "control_center.fun.result_seconds", 5, 600),
        ],
      },
    ],
  },
];

function getPath(target, path) {
  return path.split(".").reduce((value, key) => value?.[key], target);
}

function channelMatches(entry, kind) {
  if (!entry) return false;
  if (kind === "voice") return entry.type === 2;
  if (kind === "category") return entry.type === 4;
  return entry.isTextBased?.() && !entry.isThread?.();
}

function parseIds(raw) {
  const values = Array.isArray(raw) ? raw : String(raw || "").split(",");
  return values
    .flatMap((value) => String(value).split(","))
    .map((value) => value.trim())
    .filter(Boolean);
}

function parseField(guild, body, current, definition) {
  const raw = body[definition.id];
  if (definition.type === "toggle") return raw === "on";
  if (definition.type === "number") {
    const parsed = Number.parseFloat(raw);
    if (!Number.isFinite(parsed)) return current;
    return Math.min(definition.max, Math.max(definition.min, parsed));
  }
  if (definition.type === "choice") {
    if (definition.id === "language" && raw === "DISCORD") return null;
    return definition.choices.includes(raw) ? raw : current;
  }
  if (definition.type === "channel") {
    return SNOWFLAKE.test(String(raw || "")) && channelMatches(guild.channels.cache.get(raw), definition.channelKind)
      ? raw
      : null;
  }
  if (definition.type === "role") {
    return SNOWFLAKE.test(String(raw || "")) && guild.roles.cache.has(raw) ? raw : null;
  }
  if (definition.type === "roleList") {
    return [...new Set(parseIds(raw))]
      .filter((id) => SNOWFLAKE.test(id) && guild.roles.cache.has(id))
      .slice(0, definition.max);
  }
  if (definition.type === "channelList") {
    return [...new Set(parseIds(raw))]
      .filter((id) => SNOWFLAKE.test(id) && channelMatches(guild.channels.cache.get(id), definition.channelKind))
      .slice(0, definition.max);
  }

  const value = String(raw || "")
    .trim()
    .slice(0, definition.maxLength);
  if (!value) return null;
  if (definition.format === "color" && !/^#[0-9a-f]{6}$/i.test(value)) return current;
  if (definition.format === "https" && !/^https:\/\//i.test(value)) return current;
  return value;
}

function findModule(moduleId) {
  return CONTROL_MODULES.find((entry) => entry.id === moduleId) || null;
}

function moduleForView(module, settings) {
  return {
    ...module,
    groups: module.groups.map((group) => ({
      ...group,
      fields: group.fields.map((entry) => ({ ...entry, value: getPath(settings, entry.path) })),
    })),
  };
}

function buildControlPatch(guild, body, settings, module) {
  const patch = {};
  module.groups
    .flatMap((group) => group.fields)
    .forEach((definition) => {
      if (!definition.runtime) return;
      patch[definition.path] = parseField(guild, body, getPath(settings, definition.path), definition);
    });
  return patch;
}

module.exports = { CONTROL_MODULES, buildControlPatch, findModule, getPath, moduleForView };
