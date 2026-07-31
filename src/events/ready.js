const { counterHandler, inviteHandler, presenceHandler, tempVoiceHandler } = require("@src/handlers");
const { cacheReactionRoles } = require("@schemas/ReactionRoles");
const { cacheSelfRolePanels } = require("@schemas/SelfRolePanel");
const { cacheStickyMessages } = require("@schemas/StickyMessage");
const { getSettings } = require("@schemas/Guild");
const { getActiveBlock } = require("@src/services/blockedServers");
const { startScheduler } = require("@src/services/scheduler/runtime");
const { FeedWatcher } = require("@src/services/feeds/FeedWatcher");

/**
 * @param {import('@src/structures').BotClient} client
 */
module.exports = async (client) => {
  client.logger.success(`Logged in as ${client.user.tag}! (${client.user.id})`);

  // Update Bot Presence (before music init to ensure it runs even if music crashes)
  if (client.config.PRESENCE.enabled) {
    presenceHandler(client);
  }

  // Initialize Music Manager
  client.initMusicManager();

  // Initialize Giveaways Manager
  if (client.config.GIVEAWAYS.enabled) {
    client.logger.log("Initializing giveaways manager...");
    client.giveawaysManager._init().then((_) => client.logger.success("Giveaway Manager initialized"));
  }

  // Register Interactions
  if (client.config.INTERACTIONS.SLASH || client.config.INTERACTIONS.CONTEXT) {
    try {
      if (client.config.INTERACTIONS.GLOBAL) await client.registerInteractions();
      else await client.registerInteractions(client.config.INTERACTIONS.TEST_GUILD_ID);
    } catch (ex) {
      client.logger.error("Failed to register interactions", ex);
    }
  }

  // Load reaction roles to cache
  await cacheReactionRoles(client);

  // Load self role panels to cache
  const panels = await cacheSelfRolePanels(client).catch((error) => {
    client.logger.error("Failed to cache self role panels", error);
    return 0;
  });
  if (panels) client.logger.log(`Cached ${panels} self role panels`);

  // Load sticky messages to cache
  const stickies = await cacheStickyMessages(client).catch((error) => {
    client.logger.error("Failed to cache sticky messages", error);
    return 0;
  });
  if (stickies) client.logger.log(`Cached ${stickies} sticky messages`);

  // Durable timers (temporary roles, reminders, scheduled announcements)
  if (client.config.SCHEDULER?.enabled !== false) {
    try {
      startScheduler(client);
    } catch (error) {
      client.logger.error("Failed to start scheduler", error);
    }
  }

  // Twitch / YouTube / RSS / GitHub announcements
  if (client.config.FEEDS?.enabled !== false) {
    try {
      client.feedWatcher = new FeedWatcher({
        client,
        intervalMs: client.config.FEEDS?.pollIntervalMs,
      }).start();
    } catch (error) {
      client.logger.error("Failed to start feed watcher", error);
    }
  }

  if (client.config.SMART_INVITES.enabled) {
    try {
      await require("@src/services/smart-invites/runtime").start(client);
    } catch (error) {
      client.logger.error("Failed to start Smart Invites", error);
    }
  }

  for (const guild of client.guilds.cache.values()) {
    const block = await getActiveBlock(guild.id).catch((error) => {
      client.logger.error(`Failed to check server block for ${guild.id}`, error);
      return null;
    });
    if (block) {
      client.logger.warn(`Leaving blocked guild on startup: ${guild.name} (${guild.id})`);
      await guild.leave().catch((error) => client.logger.error(`Failed to leave blocked guild ${guild.id}`, error));
      continue;
    }

    const settings = await getSettings(guild);

    // initialize counter
    if (settings.counters.length > 0) {
      await counterHandler.init(guild, settings);
    }

    // cache invites
    if (settings.invite.tracking) {
      inviteHandler.cacheGuildInvites(guild);
    }

    // temporary voice channels that emptied out or vanished while the bot was down
    if (settings.temp_voice?.enabled) {
      await tempVoiceHandler
        .reconcileGuild(guild)
        .catch((error) => client.logger.error(`Failed to reconcile temp voice for ${guild.id}`, error));
    }
  }

  setInterval(() => counterHandler.updateCounterChannels(client), 10 * 60 * 1000);
};
