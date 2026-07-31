/**
 * @param {import('@src/structures').BotClient} client
 * @param {Error} error
 */
module.exports = async (client, error) => {
  client.telemetry?.record("client_errors");
  client.logger.error(`Client Error`, error);
};
