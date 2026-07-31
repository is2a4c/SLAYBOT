const { controlPanelHandler } = require("@src/handlers");
const { guildTranslator } = require("@src/i18n");

/**
 * @type {import("@structures/Command")}
 */
module.exports = {
  name: "panel",
  description: "configure every system from one button panel",
  category: "ADMIN",
  userPermissions: ["ManageGuild"],
  botPermissions: ["EmbedLinks"],
  command: {
    enabled: true,
    aliases: ["settings", "setup"],
    usage: "",
  },
  slashCommand: {
    enabled: true,
    ephemeral: true,
    options: [],
  },

  async messageRun(message, args, data) {
    const t = guildTranslator(data.settings, message.guild);
    return message.safeReply(controlPanelHandler.buildHub(t, data.settings, message.client));
  },

  async interactionRun(interaction, data) {
    const t = guildTranslator(data.settings, interaction.guild);
    return interaction.followUp(controlPanelHandler.buildHub(t, data.settings, interaction.client));
  },
};
