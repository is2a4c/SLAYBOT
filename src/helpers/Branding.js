const { resolveColor } = require("discord.js");
const config = require("@root/config");

const MAX_NAME = 60;
const MAX_FOOTER = 120;

/**
 * Per-server branding for the embeds the bot posts.
 *
 * The point is that a server can make SLAYBOT look like its own bot without a
 * separate application: name, accent colour, footer and icon are applied
 * wherever the bot builds an embed of its own.
 */

/**
 * Validate and clean a branding change.
 *
 * Pure so the rules (length limits, resolvable colour, https-only assets) are
 * testable and identical for the command and the dashboard.
 *
 * @param {{name?: string|null, color?: string|null, footer?: string|null, iconURL?: string|null}} input
 * @returns {{branding: object, errors: string[]}}
 */
function sanitizeBranding(input = {}) {
  const branding = {};
  const errors = [];

  if (input.name !== undefined && input.name !== null) {
    const name = String(input.name).trim();
    if (name.length === 0) branding.name = null;
    else if (name.length > MAX_NAME) errors.push(`The name must be at most ${MAX_NAME} characters.`);
    else branding.name = name;
  }

  if (input.color !== undefined && input.color !== null) {
    const color = String(input.color).trim();
    if (color.length === 0) {
      branding.color = null;
    } else if (!/^#[0-9a-f]{6}$/i.test(color)) {
      errors.push("The colour must be a hex value such as `#A855F7`.");
    } else {
      try {
        resolveColor(color);
        branding.color = color.toUpperCase();
      } catch {
        errors.push(`${color} is not a colour Discord accepts.`);
      }
    }
  }

  if (input.footer !== undefined && input.footer !== null) {
    const footer = String(input.footer).trim();
    if (footer.length === 0) branding.footer = null;
    else if (footer.length > MAX_FOOTER) errors.push(`The footer must be at most ${MAX_FOOTER} characters.`);
    else branding.footer = footer;
  }

  if (input.iconURL !== undefined && input.iconURL !== null) {
    const raw = String(input.iconURL).trim();
    if (raw.length === 0) {
      branding.iconURL = null;
    } else {
      let url;
      try {
        url = new URL(raw);
      } catch {
        url = null;
      }

      // https only: Discord refuses anything else, and it keeps the field from
      // becoming a way to point the bot at arbitrary internal hosts.
      if (!url || url.protocol !== "https:") errors.push("The icon must be an https URL.");
      else branding.iconURL = url.toString();
    }
  }

  return { branding, errors };
}

/**
 * The branding actually in force for a guild: its own settings where set, the
 * bot's global defaults everywhere else.
 *
 * @param {object} [settings] guild settings document
 * @param {import('discord.js').Client} [client]
 */
function resolveBranding(settings, client) {
  const guildBranding = settings?.branding || {};

  return {
    name: guildBranding.name || client?.user?.username || "SLAYBOT",
    color: guildBranding.color || config.EMBED_COLORS.BOT_EMBED,
    footer: guildBranding.footer || null,
    iconURL: guildBranding.iconURL || client?.user?.displayAvatarURL?.() || null,
  };
}

/**
 * Apply branding to an embed the bot is about to send.
 *
 * Existing colours and footers are left alone: a command that deliberately sends
 * a red error embed must stay red.
 *
 * @param {import('discord.js').EmbedBuilder} embed
 * @param {object} branding result of resolveBranding
 * @param {{force?: boolean}} [options]
 */
function applyBranding(embed, branding, { force = false } = {}) {
  if (!embed || !branding) return embed;

  if (force || embed.data.color === undefined || embed.data.color === null) {
    if (branding.color) embed.setColor(branding.color);
  }

  if (branding.footer && (force || !embed.data.footer)) {
    embed.setFooter({ text: branding.footer, iconURL: branding.iconURL || undefined });
  }

  return embed;
}

module.exports = {
  MAX_FOOTER,
  MAX_NAME,
  applyBranding,
  resolveBranding,
  sanitizeBranding,
};
