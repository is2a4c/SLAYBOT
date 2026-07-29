/**
 * @param {import('@src/structures').BotClient} client
 * @param {import('discord.js').GuildChannel} channel
 */
module.exports = async (client, channel) => {
  if (client.smartInvites) await client.smartInvites.handleChannelDeleted(channel);
};
