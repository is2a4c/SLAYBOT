const { EmbedBuilder } = require("discord.js");
const { getSettings } = require("@schemas/Guild");
const { starboardHandler } = require("@src/handlers");

/**
 * @param {import('@src/structures').BotClient} client
 * @param {import('discord.js').Message|import('discord.js').PartialMessage} message
 */
module.exports = async (client, message) => {
  // Starboard bookkeeping runs even for partials and bot messages: the deleted
  // message may itself be a starboard mirror.
  if (message.guild) {
    await starboardHandler
      .handleMessageDelete(message)
      .catch((ex) => client.logger.error("starboard: message delete", ex));
  }

  if (message.partial) return;
  if (message.author.bot || !message.guild) return;

  const settings = await getSettings(message.guild);
  if (!settings.automod?.anti_ghostping || !settings.modlog_channel) return;
  const { members, roles, everyone } = message.mentions;

  // Check message if it contains mentions
  if (members.size > 0 || roles.size > 0 || everyone) {
    const logChannel = message.guild.channels.cache.get(settings.modlog_channel);
    if (!logChannel) return;

    const embed = new EmbedBuilder()
      .setAuthor({ name: "Ghost ping detected" })
      .setDescription(
        `**Message:**\n${message.content}\n\n` +
          `**Author:** ${message.author.globalName || message.author.username} \`${message.author.id}\`\n` +
          `**Channel:** ${message.channel.toString()}`
      )
      .addFields(
        {
          name: "Members",
          value: members.size.toString(),
          inline: true,
        },
        {
          name: "Roles",
          value: roles.size.toString(),
          inline: true,
        },
        {
          name: "Everyone?",
          value: everyone ? "Yes" : "No",
          inline: true,
        }
      )
      .setFooter({ text: `Sent at: ${message.createdAt}` });

    logChannel.safeSend({ embeds: [embed] });
  }
};
