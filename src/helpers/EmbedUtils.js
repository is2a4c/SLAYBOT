const { EmbedBuilder } = require("discord.js");
const { EMBED_COLORS } = require("@root/config");
const { BRAND_ACCENT } = require("@helpers/ConfigDefaults");
const { resolveBranding } = require("@helpers/Branding");

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
 *
 * Pass `settings` (a guild settings document) to honour that server's own
 * branding - name, accent colour and footer - instead of the bot defaults.
 *
 * @param {import('discord.js').Client} client
 * @param {"DEFAULT"|"BRAND"|"SUCCESS"|"ERROR"|"WARNING"|"INFO"} [type]
 * @param {{ footer?: boolean, timestamp?: boolean, settings?: object }} [options]
 */
function brandEmbed(client, type = "DEFAULT", { footer = true, timestamp = false, settings } = {}) {
  const embed = new EmbedBuilder().setColor((TYPE_COLORS[type] || TYPE_COLORS.DEFAULT)());
  const branding = resolveBranding(settings, client);

  // Semantic colours (error, warning, ...) keep their meaning; only the neutral
  // brand embeds take the server's accent.
  if (["DEFAULT", "BRAND"].includes(type) && branding.color) embed.setColor(branding.color);

  if (footer) {
    if (branding.footer) embed.setFooter({ text: branding.footer, iconURL: branding.iconURL || undefined });
    else if (client?.user) embed.setFooter({ text: branding.name, iconURL: client.user.displayAvatarURL() });
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
