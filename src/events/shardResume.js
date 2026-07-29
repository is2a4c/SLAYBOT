const presenceHandler = require("@src/handlers/presence");

/**
 * Restore the configured presence after Discord resumes a gateway session.
 * A CPU-starved reconnect may otherwise leave the bot at the default online
 * state until the next scheduled presence rotation.
 *
 * @param {import("@src/structures").BotClient} client
 * @param {number} shardId
 * @param {number} replayedEvents
 */
module.exports = async (client, shardId, replayedEvents) => {
  if (!client.config.PRESENCE.enabled) return;
  presenceHandler.updatePresence(client);
  client.logger.log(`Shard ${shardId} resumed (${replayedEvents} replayed events); presence restored`);
};
