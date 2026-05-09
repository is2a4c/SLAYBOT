/**
 * SLAYBOT Configuration File
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

  // Dashboard Configuration
  DASHBOARD: {
    enabled: false,
    baseURL: "http://localhost:8080",
    failureURL: "http://localhost:8080/failure",
    port: 8080,
  },

  // Prefix Commands Configuration
  PREFIX_COMMANDS: {
    enabled: true,
    DEFAULT_PREFIX: "!",
  },

  // Music Configuration
  MUSIC: {
    enabled: false,
    DEFAULT_SOURCE: "YT", // YT, YTM, or SC
    LAVALINK_NODES: [
      {
        host: "localhost",
        port: 2333,
        password: "youshallnotpass",
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
    APPROVED_EMBED: "#57F287",
    DENIED_EMBED: "#ED4245",
  },

  // Ticket Configuration
  TICKET: {
    enabled: true,
    log_channel: "",
    limit: 10,
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
    STATUS: "online", // online, idle, dnd, invisible
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
    BOT_EMBED: "#2F3136",
    OK: "#57F287",
    ERROR: "#ED4245",
    WARNING: "#FEE75C",
    INFO: "#3498DB",
    SUCCESS: "#57F287",
  },

  // Messages
  MESSAGES: {
    ERRORS: {
      INTERNAL: "An internal error occurred while executing this command",
    },
  },
};
