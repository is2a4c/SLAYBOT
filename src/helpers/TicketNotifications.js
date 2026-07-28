const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require("discord.js");
const { TICKET } = require("@root/config.js");

function getNotificationRoleIds(settings, category, guild) {
  const roleIds = new Set([...(settings?.ticket?.staff_roles || []), ...(category?.staff_roles || [])]);
  return [...roleIds].filter((roleId) => roleId !== guild.id && guild.roles.cache.has(roleId));
}

function buildCategoryNotificationPayload({ guild, user, category, ticketMessage, roleIds }) {
  const embed = new EmbedBuilder()
    .setAuthor({ name: "New Ticket" })
    .setColor(TICKET.CREATE_EMBED)
    .setTimestamp()
    .addFields(
      { name: "Category", value: category.name, inline: true },
      { name: "Opened By", value: `${user.toString()} (\`${user.id}\`)`, inline: true },
      { name: "Ticket", value: ticketMessage.channel.toString(), inline: false }
    );
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setLabel("View Ticket").setURL(ticketMessage.url).setStyle(ButtonStyle.Link)
  );

  return {
    content: roleIds.length > 0 ? roleIds.map((roleId) => `<@&${roleId}>`).join(" ") : undefined,
    embeds: [embed],
    components: [row],
    allowedMentions: { roles: roleIds },
  };
}

async function sendCategoryTicketNotification({ guild, user, settings, category, ticketMessage }) {
  if (!category?.notification_channel) return false;

  const notificationChannel = guild.channels.cache.get(category.notification_channel);
  if (!notificationChannel?.canSendEmbeds?.()) return false;

  const roleIds = getNotificationRoleIds(settings, category, guild);
  const payload = buildCategoryNotificationPayload({ guild, user, category, ticketMessage, roleIds });
  return Boolean(await notificationChannel.safeSend(payload));
}

module.exports = {
  buildCategoryNotificationPayload,
  getNotificationRoleIds,
  sendCategoryTicketNotification,
};
