const { resolveColor } = require("discord.js");

// SLAYBOT brand accent. The logo is monochrome, so the neutral embed colour is the
// place the brand lives. Legacy configs shipped Discord's dead grey (#2F3136); those
// are auto-upgraded to the accent at startup so every BOT_EMBED embed is themed
// without touching individual commands.
const BRAND_ACCENT = "#A855F7";
const LEGACY_NEUTRALS = ["#2f3136", "#36393f", "#202225", "#000000"];

const DEFAULT_CONFIG = {
  OWNER_IDS: [],
  SUPPORT_SERVER: "",
  CACHE_SIZE: {
    GUILDS: 100,
    USERS: 100,
    MEMBERS: 50,
  },
  DASHBOARD: {
    enabled: false,
    baseURL: "http://localhost:8080/dashboard",
    failureURL: "http://localhost:8080/dashboard",
    port: 8080,
  },
  PREFIX_COMMANDS: {
    enabled: true,
    DEFAULT_PREFIX: "!",
  },
  MUSIC: {
    enabled: true,
    DEFAULT_SOURCE: "YT",
    LAVALINK_NODES: [],
    IDLE_TIME: 60,
    MAX_SEARCH_RESULTS: 10,
  },
  GIVEAWAYS: {
    enabled: true,
    START_EMBED: "#FFDF00",
    END_EMBED: "#FF0000",
    REACTION: "🎉",
  },
  STATS: {
    enabled: true,
    XP_COOLDOWN: 60,
    DEFAULT_LVL_UP_MSG: "{member}, You leveled up to **{level}**! 🎉",
  },
  SUGGESTIONS: {
    enabled: true,
    EMOJI: {
      UP_VOTE: "⬆️",
      DOWN_VOTE: "⬇️",
    },
    DEFAULT_EMBED: "#3498DB",
    APPROVED_EMBED: "#57F287",
    DENIED_EMBED: "#ED4245",
  },
  TICKET: {
    enabled: true,
    log_channel: "",
    limit: 10,
    CREATE_EMBED: "#57F287",
    CLOSE_EMBED: "#ED4245",
  },
  INVITE: {
    enabled: true,
    tracking: true,
  },
  AUTOMOD: {
    enabled: true,
    debug: false,
    strikes: 10,
    action: "TIMEOUT",
    anti_attachments: false,
    anti_invites: false,
    anti_links: false,
    anti_spam: false,
    spam_whitelist_users: [],
    spam_whitelist_roles: [],
    anti_image_spam: false,
    image_spam_threshold: 70,
    anti_ghostping: false,
    anti_massmention: 0,
    max_lines: 0,
    max_mentions: 5,
    max_role_mentions: 3,
    LOG_EMBED: "#ED4245",
    DM_EMBED: "#FEE75C",
  },
  ECONOMY: {
    enabled: true,
    CURRENCY: "🪙",
    DAILY_COINS: 100,
    MIN_BEG_AMOUNT: 1,
    MAX_BEG_AMOUNT: 50,
    GAMBLE_MULTIPLIER: 2,
  },
  IMAGE: {
    enabled: true,
    BASE_API: process.env.STRANGE_API_URL || "https://api.strangeapi.com",
  },
  MODERATION: {
    enabled: true,
    EMBED_COLORS: {
      TIMEOUT: "#FFA500",
      UNTIMEOUT: "#57F287",
      KICK: "#FFA500",
      SOFTBAN: "#FF7F00",
      BAN: "#ED4245",
      UNBAN: "#57F287",
      VMUTE: "#FFA500",
      VUNMUTE: "#57F287",
      DEAFEN: "#FFA500",
      UNDEAFEN: "#57F287",
      DISCONNECT: "#FFA500",
      MOVE: "#3498DB",
      WARN: "#FEE75C",
    },
  },
  PRESENCE: {
    enabled: true,
    TYPE: "PLAYING",
    STATUS: "idle",
    MESSAGE: ["SLAYBOT", "Discord.js v14"],
  },
  INTERACTIONS: {
    SLASH: true,
    CONTEXT: true,
    GLOBAL: true,
    TEST_GUILD_ID: "",
  },
  EMBED_COLORS: {
    BOT_EMBED: BRAND_ACCENT,
    OK: "#57F287",
    ERROR: "#ED4245",
    WARNING: "#FEE75C",
    INFO: "#3498DB",
    SUCCESS: "#57F287",
    GIVEAWAYS: "#FFDF00",
    TRANSPARENT: null,
  },
  MESSAGES: {
    API_ERROR: "The API is currently unavailable. Please try again later.",
    ERRORS: {
      INTERNAL: "An internal error occurred while executing this command",
    },
  },
  SLAYNODE: {
    enabled: false,
    host: "127.0.0.1",
    port: 8090,
    leaseMs: 60000,
    maxPayloadBytes: 8388608,
    verificationRate: 0.05,
    canaryIntervalMs: 3600000,
    allowedWorkerDigests: [],
    tiers: [
      { name: "Platinum", score: 90 },
      { name: "Gold", score: 75 },
      { name: "Silver", score: 55 },
      { name: "Bronze", score: 0 },
    ],
  },
  SMART_INVITES: {
    enabled: false,
    baseURL: "https://slaybot.televibe.host",
    pathPrefix: "",
    host: "127.0.0.1",
    port: 8081,
    maxPerGuild: 5,
    validationTtlMs: 300000,
    healthCheckIntervalMs: 900000,
    regenerationLeaseMs: 15000,
    deletedSlugRetentionMs: 2592000000,
    aliasRetentionMs: 2592000000,
    backgroundChecks: true,
    redirectMode: "preview",
    officialGuildId: "",
    officialSlug: "slaybot",
    reservedSlugs: [],
    blockedGuildIds: [],
    trustProxy: true,
    commandCooldownSeconds: 5,
    publicRateLimitWindowMs: 60000,
    publicRateLimitMax: 120,
    backgroundConcurrency: 3,
  },
};

const COLOR_DEFAULTS = {
  "AUTOMOD.LOG_EMBED": DEFAULT_CONFIG.AUTOMOD.LOG_EMBED,
  "AUTOMOD.DM_EMBED": DEFAULT_CONFIG.AUTOMOD.DM_EMBED,
  "EMBED_COLORS.BOT_EMBED": DEFAULT_CONFIG.EMBED_COLORS.BOT_EMBED,
  "EMBED_COLORS.OK": DEFAULT_CONFIG.EMBED_COLORS.OK,
  "EMBED_COLORS.ERROR": DEFAULT_CONFIG.EMBED_COLORS.ERROR,
  "EMBED_COLORS.WARNING": DEFAULT_CONFIG.EMBED_COLORS.WARNING,
  "EMBED_COLORS.INFO": DEFAULT_CONFIG.EMBED_COLORS.INFO,
  "EMBED_COLORS.SUCCESS": DEFAULT_CONFIG.EMBED_COLORS.SUCCESS,
  "EMBED_COLORS.GIVEAWAYS": DEFAULT_CONFIG.EMBED_COLORS.GIVEAWAYS,
  "SUGGESTIONS.DEFAULT_EMBED": DEFAULT_CONFIG.SUGGESTIONS.DEFAULT_EMBED,
  "SUGGESTIONS.APPROVED_EMBED": DEFAULT_CONFIG.SUGGESTIONS.APPROVED_EMBED,
  "SUGGESTIONS.DENIED_EMBED": DEFAULT_CONFIG.SUGGESTIONS.DENIED_EMBED,
  "TICKET.CREATE_EMBED": DEFAULT_CONFIG.TICKET.CREATE_EMBED,
  "TICKET.CLOSE_EMBED": DEFAULT_CONFIG.TICKET.CLOSE_EMBED,
  "GIVEAWAYS.START_EMBED": DEFAULT_CONFIG.GIVEAWAYS.START_EMBED,
  "GIVEAWAYS.END_EMBED": DEFAULT_CONFIG.GIVEAWAYS.END_EMBED,
  "MODERATION.EMBED_COLORS.TIMEOUT": DEFAULT_CONFIG.MODERATION.EMBED_COLORS.TIMEOUT,
  "MODERATION.EMBED_COLORS.UNTIMEOUT": DEFAULT_CONFIG.MODERATION.EMBED_COLORS.UNTIMEOUT,
  "MODERATION.EMBED_COLORS.KICK": DEFAULT_CONFIG.MODERATION.EMBED_COLORS.KICK,
  "MODERATION.EMBED_COLORS.SOFTBAN": DEFAULT_CONFIG.MODERATION.EMBED_COLORS.SOFTBAN,
  "MODERATION.EMBED_COLORS.BAN": DEFAULT_CONFIG.MODERATION.EMBED_COLORS.BAN,
  "MODERATION.EMBED_COLORS.UNBAN": DEFAULT_CONFIG.MODERATION.EMBED_COLORS.UNBAN,
  "MODERATION.EMBED_COLORS.VMUTE": DEFAULT_CONFIG.MODERATION.EMBED_COLORS.VMUTE,
  "MODERATION.EMBED_COLORS.VUNMUTE": DEFAULT_CONFIG.MODERATION.EMBED_COLORS.VUNMUTE,
  "MODERATION.EMBED_COLORS.DEAFEN": DEFAULT_CONFIG.MODERATION.EMBED_COLORS.DEAFEN,
  "MODERATION.EMBED_COLORS.UNDEAFEN": DEFAULT_CONFIG.MODERATION.EMBED_COLORS.UNDEAFEN,
  "MODERATION.EMBED_COLORS.DISCONNECT": DEFAULT_CONFIG.MODERATION.EMBED_COLORS.DISCONNECT,
  "MODERATION.EMBED_COLORS.MOVE": DEFAULT_CONFIG.MODERATION.EMBED_COLORS.MOVE,
  "MODERATION.EMBED_COLORS.WARN": DEFAULT_CONFIG.MODERATION.EMBED_COLORS.WARN,
};

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function mergeMissing(target, defaults) {
  Object.entries(defaults).forEach(([key, value]) => {
    if (target[key] === undefined) {
      target[key] = isPlainObject(value) ? mergeMissing({}, value) : value;
      return;
    }

    if (isPlainObject(target[key]) && isPlainObject(value)) {
      mergeMissing(target[key], value);
    }
  });

  return target;
}

function getPath(target, path) {
  return path.split(".").reduce((value, key) => value?.[key], target);
}

function setPath(target, path, value) {
  const parts = path.split(".");
  const last = parts.pop();
  const parent = parts.reduce((current, key) => {
    if (!isPlainObject(current[key])) current[key] = {};
    return current[key];
  }, target);
  parent[last] = value;
}

function isResolvableColor(value) {
  if (value === null) return true;

  try {
    resolveColor(value);
    return true;
  } catch {
    return false;
  }
}

function normalizeColors(config) {
  Object.entries(COLOR_DEFAULTS).forEach(([path, fallback]) => {
    if (!isResolvableColor(getPath(config, path))) {
      setPath(config, path, fallback);
    }
  });
}

// Retheme installs that still carry a legacy neutral BOT_EMBED. A config that has
// deliberately set some other colour is left untouched.
function applyBrandTheme(config) {
  const current = getPath(config, "EMBED_COLORS.BOT_EMBED");
  if (!current || LEGACY_NEUTRALS.includes(String(current).toLowerCase())) {
    setPath(config, "EMBED_COLORS.BOT_EMBED", BRAND_ACCENT);
  }
}

function applySmartInviteEnvironment(config) {
  const smartInvites = config.SMART_INVITES;
  if (!smartInvites) return;

  if (process.env.SMART_INVITES_ENABLED !== undefined) {
    smartInvites.enabled = process.env.SMART_INVITES_ENABLED === "true";
  }
  if (process.env.SMART_INVITES_BASE_URL) {
    smartInvites.baseURL = process.env.SMART_INVITES_BASE_URL;
  }
  if (process.env.SMART_INVITES_HOST) {
    smartInvites.host = process.env.SMART_INVITES_HOST;
  }
  if (process.env.SMART_INVITES_OFFICIAL_GUILD_ID) {
    smartInvites.officialGuildId = process.env.SMART_INVITES_OFFICIAL_GUILD_ID;
  }
}

function applyConfigDefaults(config = require("@root/config")) {
  mergeMissing(config, DEFAULT_CONFIG);
  applySmartInviteEnvironment(config);
  normalizeColors(config);
  applyBrandTheme(config);
  return config;
}

module.exports = {
  DEFAULT_CONFIG,
  BRAND_ACCENT,
  applySmartInviteEnvironment,
  applyConfigDefaults,
};
