const { counterHandler, inviteHandler, presenceHandler } = require("@src/handlers");
const { cacheReactionRoles } = require("@schemas/ReactionRoles");
const { getSettings } = require("@schemas/Guild");

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

  for (const guild of client.guilds.cache.values()) {
    const settings = await getSettings(guild);

    // initialize counter
    if (settings.counters.length > 0) {
      await counterHandler.init(guild, settings);
    }

    // cache invites
    if (settings.invite.tracking) {
      inviteHandler.cacheGuildInvites(guild);
    }
  }

  setInterval(() => counterHandler.updateCounterChannels(client), 10 * 60 * 1000);
};
