const { EmbedBuilder } = require("discord.js");
const { EMBED_COLORS } = require("@root/config");
const { BRAND_ACCENT } = require("@helpers/ConfigDefaults");

// Resolves the brand accent, never falling back to Discord's dead grey.
const accent = () => EMBED_COLORS?.BOT_EMBED || BRAND_ACCENT;

const TYPE_COLORS = {
  DEFAULT: () => accent(),
  BRAND: () => accent(),
  SUCCESS: () => EMBED_COLORS?.SUCCESS || "#57F287",
  ERROR: () => EMBED_COLORS?.ERROR || "#ED4245",
  WARNING: () => EMBED_COLORS?.WARNING || "#FEE75C",
  INFO: () => EMBED_COLORS?.INFO || "#3498DB",
};

/**
 * A pre-branded embed: accent colour plus a consistent bot footer.
 * @param {import('discord.js').Client} client
 * @param {"DEFAULT"|"BRAND"|"SUCCESS"|"ERROR"|"WARNING"|"INFO"} [type]
 * @param {{ footer?: boolean, timestamp?: boolean }} [options]
 */
function brandEmbed(client, type = "DEFAULT", { footer = true, timestamp = false } = {}) {
  const embed = new EmbedBuilder().setColor((TYPE_COLORS[type] || TYPE_COLORS.DEFAULT)());
  if (footer && client?.user) {
    embed.setFooter({ text: client.user.username, iconURL: client.user.displayAvatarURL() });
  }
  if (timestamp) embed.setTimestamp();
  return embed;
}

// Small semantic shortcuts for one-line status replies.
const success = (client, description) => brandEmbed(client, "SUCCESS").setDescription(`✅ ${description}`);
const error = (client, description) => brandEmbed(client, "ERROR").setDescription(`❌ ${description}`);
const warn = (client, description) => brandEmbed(client, "WARNING").setDescription(`⚠️ ${description}`);
const info = (client, description) => brandEmbed(client, "INFO").setDescription(`ℹ️ ${description}`);

module.exports = { BRAND_ACCENT, accent, brandEmbed, success, error, warn, info };
