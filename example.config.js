/**
 * SLAYBOT Example Configuration File
 *
 * Copy this file to config.js and adjust values for your environment.
 * config.js is intentionally ignored by git.
 */

module.exports = {
  // Owner IDs - Users who have full access to the bot
  OWNER_IDS: [],

  // Support Server Invite URL
  SUPPORT_SERVER: "",

  // Cache sizes (must be positive integers)
  CACHE_SIZE: {
    GUILDS: 100,
    USERS: 100,
    MEMBERS: 50,
  },

  // Dashboard Configuration. The app always serves itself under the /dashboard
  // path (see dashboard/app.js) so it can share a domain/reverse proxy with
  // other services (e.g. Smart Invites) without colliding at the root - set
  // baseURL to the full public URL INCLUDING that path, e.g.
  // "https://your-domain.example/dashboard". failureURL only needs to be a
  // truthy string (kept for backwards-compatible validation); OAuth failures
  // just redirect back to the dashboard root.
  DASHBOARD: {
    enabled: false,
    baseURL: "http://localhost:8080/dashboard",
    failureURL: "http://localhost:8080/dashboard",
    port: 8080,
  },

  // SlayNode Partner Control Plane. Expose only behind TLS in production.
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

  // Stable public Discord invite pages. Requires MongoDB and a reverse proxy
  // terminating HTTPS in production.
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

  // Prefix Commands Configuration
  PREFIX_COMMANDS: {
    enabled: true,
    DEFAULT_PREFIX: "!",
  },

  // Music Configuration
  MUSIC: {
    enabled: true,
    DEFAULT_SOURCE: "YT", // YT, YTM, or SC
    LAVALINK_NODES: [
      {
        id: "Serenetia",
        host: "lavalinkv4.serenetia.com",
        port: 443,
        password: "https://seretia.link/discord",
        secure: true,
      },
      {
        id: "MilloHost",
        host: "lava-v4.millohost.my.id",
        port: 443,
        password: "https://discord.gg/mjS5J2K3ep",
        secure: true,
      },
      {
        id: "TriniumHost",
        host: "lavalink-v4.triniumhost.com",
        port: 443,
        password: "free",
        secure: true,
      },
    ],
    IDLE_TIME: 60, // seconds before destroying player when alone
    MAX_SEARCH_RESULTS: 10, // max results to show in music search
  },

  // Giveaways Configuration
  GIVEAWAYS: {
    enabled: true,
    START_EMBED: "#FFDF00",
    END_EMBED: "#FF0000",
    REACTION: "🎉",
  },

  // Stats Configuration
  STATS: {
    enabled: true,
    XP_COOLDOWN: 60, // seconds
    DEFAULT_LVL_UP_MSG: "{member}, You leveled up to **{level}**! 🎉",
  },

  // Suggestions Configuration
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

  // Ticket Configuration
  TICKET: {
    enabled: true,
    log_channel: "",
    limit: 10,
    CREATE_EMBED: "#57F287",
    CLOSE_EMBED: "#ED4245",
  },

  // Invite Configuration
  INVITE: {
    enabled: true,
    tracking: true,
  },

  // Automod Configuration
  AUTOMOD: {
    enabled: true,
    debug: false,
    strikes: 10,
    action: "TIMEOUT",
    anti_attachments: false,
    anti_invites: false,
    anti_links: false,
    anti_spam: false,
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

  // Economy Configuration
  ECONOMY: {
    enabled: true,
    CURRENCY: "🪙",
    DAILY_COINS: 100,
    MIN_BEG_AMOUNT: 1,
    MAX_BEG_AMOUNT: 50,
    GAMBLE_MULTIPLIER: 2,
  },

  // Image Configuration
  IMAGE: {
    enabled: true,
    BASE_API: process.env.STRANGE_API_URL || "https://api.strangeapi.com",
  },

  // Moderation Configuration
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

  // Presence Configuration
  PRESENCE: {
    enabled: true,
    TYPE: "PLAYING", // PLAYING, LISTENING, WATCHING, COMPETING, CUSTOM
    STATUS: "idle", // online, idle, dnd, invisible
    MESSAGE: ["SLAYBOT", "Discord.js v14"],
  },

  // Interactions Configuration
  INTERACTIONS: {
    SLASH: true,
    CONTEXT: true,
    GLOBAL: true, // Register globally (set false to register for specific guild)
    TEST_GUILD_ID: "", // Guild ID for testing (used when GLOBAL is false)
  },

  // Embed Colors
  EMBED_COLORS: {
    BOT_EMBED: "#A855F7", // SLAYBOT brand accent (was Discord grey #2F3136)
    OK: "#57F287",
    ERROR: "#ED4245",
    WARNING: "#FEE75C",
    INFO: "#3498DB",
    SUCCESS: "#57F287",
    GIVEAWAYS: "#FFDF00",
    TRANSPARENT: null,
  },

  // Messages
  MESSAGES: {
    API_ERROR: "The API is currently unavailable. Please try again later.",
    ERRORS: {
      INTERNAL: "An internal error occurred while executing this command",
    },
  },
};
