const presenceHandler = require("@src/handlers/presence");

/**
 * Restore the configured presence after a shard reconnects with a fresh session.
 *
 * A resumed session keeps the old presence and is handled in shardResume, but a
 * full reconnect starts from Discord's default: plain "online", without the
 * server and member counts. Without this the status stays blank until the next
 * rotation, which is ten minutes away.
 *
 * @param {import("@src/structures").BotClient} client
 * @param {number} shardId
 */
module.exports = async (client, shardId) => {
  if (!client.config.PRESENCE.enabled) return;

  presenceHandler.updatePresence(client);
  client.logger.log(`Shard ${shardId} ready; presence restored`);
};
