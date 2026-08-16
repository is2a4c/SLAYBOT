const { AuditLogEvent } = require("discord.js");
const { resolveAuditActor, routeEvent } = require("@src/services/eventRouter/EventRouter");
const { getSettings } = require("@schemas/Guild");
const { muteRoleId, usesRoleMute } = require("@src/services/moderation/policy");
const { ensureChannelOverwrite } = require("@src/services/moderation/muteRole");

/**
 * @param {import('@src/structures').BotClient} client
 * @param {import('discord.js').GuildChannel} channel
 */
module.exports = async (client, channel) => {
  if (!channel.guild) return;
  const actor = await resolveAuditActor(channel.guild, { type: AuditLogEvent.ChannelCreate, targetId: channel.id });
  await routeEvent(channel.guild, "CHANNEL_CREATE", {
    actor,
    detail: channel.name,
    channelId: channel.id,
    logger: client.logger,
  });

  // A fresh channel should not be a hole in an already-configured mute role.
  const settings = await getSettings(channel.guild);
  if (usesRoleMute(settings)) {
    const role = channel.guild.roles.cache.get(muteRoleId(settings));
    if (role) await ensureChannelOverwrite(channel, role, settings).catch(() => {});
  }
};
