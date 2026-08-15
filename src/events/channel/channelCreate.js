const { AuditLogEvent } = require("discord.js");
const { resolveAuditActor, routeEvent } = require("@src/services/eventRouter/EventRouter");

/**
 * @param {import('@src/structures').BotClient} client
 * @param {import('discord.js').GuildChannel} channel
 */
module.exports = async (client, channel) => {
  if (!channel.guild) return;
  const actor = await resolveAuditActor(channel.guild, { type: AuditLogEvent.ChannelCreate, targetId: channel.id });
  await routeEvent(channel.guild, "CHANNEL_CREATE", { actor, detail: channel.name, logger: client.logger });
};
