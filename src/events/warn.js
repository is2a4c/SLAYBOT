/**
 * @param {import('@src/structures').BotClient} client
 * @param {string} message
 */
module.exports = async (client, message) => {
  client.telemetry?.record("client_warnings");
  client.logger.warn(`Client Warning: ${message}`);
};
