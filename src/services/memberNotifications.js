const { buildEmbed, buildLinkButtons } = require("@src/services/richMessage/RichMessage");

function render(value, member) {
  return String(value || "")
    .replaceAll("{server}", member.guild.name)
    .replaceAll("{member:id}", member.id)
    .replaceAll("{member:name}", member.displayName)
    .replaceAll("{member:mention}", `<@${member.id}>`)
    .replaceAll("{boosts}", String(member.guild.premiumSubscriptionCount || 0));
}

async function boostPayload(member, config) {
  const renderText = (value) => render(value, member);
  const boosts = member.guild.premiumSubscriptionCount || 0;
  const embed = await buildEmbed(
    {
      title: config.boost_title,
      description: config.boost_message || `**${member.displayName}** boosted the server!`,
      author: config.boost_author,
      color: config.boost_color || "#f47fff",
      thumbnail: config.boost_thumbnail !== false ? member.displayAvatarURL?.() || null : null,
      footer: config.boost_footer || `${boosts} boosts`,
      image: config.boost_image,
      timestamp: config.boost_timestamp !== false,
      fields: config.boost_fields,
    },
    renderText
  );
  const buttons = await buildLinkButtons(config.boost_buttons, renderText);
  return {
    content: `<@${member.id}>`,
    embeds: embed ? [embed] : [],
    components: buttons,
    allowedMentions: { users: [member.id], parse: [] },
  };
}

async function sendBoostNotification(member, settings) {
  const config = settings.control_center?.notifications;
  if (!config?.boost_enabled || !config.boost_channel) return false;
  const channel = member.guild.channels.cache.get(config.boost_channel);
  if (!channel?.isTextBased?.()) return false;
  return Boolean(await channel.send(await boostPayload(member, config)).catch(() => null));
}

module.exports = { boostPayload, render, sendBoostNotification };
