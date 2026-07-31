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
    options: [],
  },

  async messageRun(message, args, data) {
    return message.safeReply(panelFor(message.guild, data.settings));
  },

  async interactionRun(interaction, data) {
    return interaction.followUp(panelFor(interaction.guild, data.settings));
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
