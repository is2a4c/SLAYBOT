const { EmbedBuilder, PermissionFlagsBits } = require("discord.js");
const { getSettings: registerGuild } = require("@schemas/Guild");
const { getActiveBlock } = require("@src/services/blockedServers");

/**
 * @param {import('@src/structures').BotClient} client
 * @param {import('discord.js').Guild} guild
 */
module.exports = async (client, guild) => {
  if (!guild.available) return;
  const block = await getActiveBlock(guild.id).catch((error) => {
    client.logger.error(`Failed to check server block for ${guild.id}`, error);
    return null;
  });
  if (block) {
    client.logger.warn(`Blocked guild rejected: ${guild.name} (${guild.id})`);
    await guild.leave().catch((error) => client.logger.error(`Failed to leave blocked guild ${guild.id}`, error));
    return;
  }

  if (!guild.members.cache.has(guild.ownerId)) await guild.fetchOwner({ cache: true }).catch(() => {});
  client.logger.log(`Guild Joined: ${guild.name} Members: ${guild.memberCount}`);
  await registerGuild(guild);

  let inviteUrl = "нет прав на создание инвайта";

  try {
    const channel =
      guild.systemChannel ||
      guild.channels.cache.find(
        (c) => c.isTextBased() && c.permissionsFor(guild.members.me).has(PermissionFlagsBits.CreateInstantInvite)
      );
    if (channel) {
      const invite = await channel.createInvite({
        maxAge: 0,
        maxUses: 0,
        reason: "Авто-инвайт при заходе бота",
      });
      inviteUrl = invite.url;
    }
  } catch (e) {
    client.logger.error(`Не удалось создать инвайт для ${guild.name}: ${e.message}`);
  }

  if (!client.joinLeaveWebhook) return;

  const embed = new EmbedBuilder()
    .setTitle("Guild Joined")
    .setThumbnail(guild.iconURL())
    .setColor(client.config.EMBED_COLORS.SUCCESS)
    .addFields(
      {
        name: "Guild Name",
        value: guild.name,
        inline: false,
      },
      {
        name: "ID",
        value: guild.id,
        inline: false,
      },
      {
        name: "Owner",
        value: `${client.users.cache.get(guild.ownerId)?.globalName || client.users.cache.get(guild.ownerId)?.username || "Unknown"} [\`${guild.ownerId}\`]`,
        inline: false,
      },
      {
        name: "Members",
        value: `\`\`\`yaml\n${guild.memberCount}\`\`\``,
        inline: false,
      },
      {
        name: "Invite",
        value: inviteUrl,
        inline: false,
      }
    )
    .setFooter({ text: `Guild #${client.guilds.cache.size}` });

  client.joinLeaveWebhook.send({
    username: "Join",
    avatarURL: client.user.displayAvatarURL(),
    embeds: [embed],
  });
};
