const { AuditLogEvent } = require("discord.js");
const { resolveAuditActor, routeEvent } = require("@src/services/eventRouter/EventRouter");

/**
 * @param {import('@src/structures').BotClient} client
 * @param {import('discord.js').GuildChannel} channel
 */
module.exports = async (client, channel) => {
  if (client.smartInvites) await client.smartInvites.handleChannelDeleted(channel);
  if (!channel.guild) return;

  const actor = await resolveAuditActor(channel.guild, { type: AuditLogEvent.ChannelDelete, targetId: channel.id });
  await routeEvent(channel.guild, "CHANNEL_DELETE", {
    actor,
    detail: channel.name,
    channelId: channel.id,
    logger: client.logger,
  });
};
