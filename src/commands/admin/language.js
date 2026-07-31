const { languageHandler } = require("@src/handlers");
const { guildTranslator } = require("@src/i18n");

/**
 * @type {import("@structures/Command")}
 */
module.exports = {
  name: "language",
  description: "pick the language the bot speaks on this server",
  category: "ADMIN",
  userPermissions: ["ManageGuild"],
  botPermissions: ["EmbedLinks"],
  command: {
    enabled: true,
    aliases: ["lang"],
    usage: "",
  },
  slashCommand: {
    enabled: true,
    ephemeral: true,
    options: [],
  },

  async messageRun(message, args, data) {
    const t = guildTranslator(data.settings, message.guild);
    return message.safeReply(languageHandler.buildPanel(t, data.settings, message.guild));
  },

  async interactionRun(interaction, data) {
    const t = guildTranslator(data.settings, interaction.guild);
    return interaction.followUp(languageHandler.buildPanel(t, data.settings, interaction.guild));
  },
};
