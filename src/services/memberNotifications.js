const { EmbedBuilder } = require("discord.js");

function render(value, member) {
  return String(value || "")
    .replaceAll("{server}", member.guild.name)
    .replaceAll("{member:id}", member.id)
    .replaceAll("{member:name}", member.displayName)
    .replaceAll("{member:mention}", `<@${member.id}>`)
    .replaceAll("{boosts}", String(member.guild.premiumSubscriptionCount || 0));
}

function boostPayload(member, config) {
  const message = render(config.boost_message, member).slice(0, 1000);
  const embed = new EmbedBuilder()
    .setColor("#f47fff")
    .setAuthor({ name: "Server boost" })
    .setThumbnail(member.displayAvatarURL?.() || null)
    .setDescription(message || `**${member.displayName}** boosted the server!`)
    .setFooter({ text: `${member.guild.premiumSubscriptionCount || 0} boosts` })
    .setTimestamp();
  return {
    content: `<@${member.id}>`,
    embeds: [embed],
    allowedMentions: { users: [member.id], parse: [] },
  };
}

async function sendBoostNotification(member, settings) {
  const config = settings.control_center?.notifications;
  if (!config?.boost_enabled || !config.boost_channel) return false;
  const channel = member.guild.channels.cache.get(config.boost_channel);
  if (!channel?.isTextBased?.()) return false;
  return Boolean(await channel.send(boostPayload(member, config)).catch(() => null));
}

module.exports = { boostPayload, render, sendBoostNotification };
