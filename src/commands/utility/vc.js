const { tempVoiceHandler } = require("@src/handlers");
const { guildTranslator } = require("@src/i18n");

/**
 * @type {import("@structures/Command")}
 */
module.exports = {
  name: "vc",
  description: "open the control panel for your own voice channel",
  category: "UTILITY",
  botPermissions: ["EmbedLinks"],
  command: {
    enabled: true,
    aliases: ["myvoice", "tempvc-panel"],
    usage: "",
  },
  slashCommand: {
    enabled: true,
    ephemeral: true,
    // The panel is drawn from settings already in memory; no need to stall first.
    defer: false,
    options: [],
  },

  async messageRun(message, args, data) {
    return message.safeReply(panelFor(message.guild, data.settings));
  },

  async interactionRun(interaction, data) {
    const panel = panelFor(interaction.guild, data.settings);
    const payload = typeof panel === "string" ? { content: panel } : panel;

    return interaction.reply({ ...payload, ephemeral: true });
  },
};

/**
 * A private copy of the panel, so the buttons are reachable without scrolling
 * back to wherever an admin posted them.
 *
 * @param {import('discord.js').Guild} guild
 * @param {object} settings guild settings document
 */
function panelFor(guild, settings) {
  const t = guildTranslator(settings, guild);
  if (!settings.temp_voice?.enabled) return t("tempvoice.errors.disabled");

  return tempVoiceHandler.buildPanel(t, { settings, client: guild.client });
}
