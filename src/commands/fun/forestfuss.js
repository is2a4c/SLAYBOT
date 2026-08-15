const { guildTranslator, interactionTranslator } = require("@src/i18n");
const { startSession } = require("@src/services/forestFuss/game");

/**
 * @type {import("@structures/Command")}
 */
module.exports = {
  name: "forestfuss",
  description: "starts a Forest Fuss game - wolves against villagers",
  cooldown: 10,
  category: "FUN",
  botPermissions: ["ManageChannels", "EmbedLinks"],
  command: {
    enabled: true,
  },
  slashCommand: {
    enabled: true,
    options: [],
  },

  async messageRun(message, args, data) {
    const result = await startSession({
      client: message.client,
      guild: message.guild,
      leader: message.member,
      settings: data.settings,
    });

    const t = guildTranslator(data.settings, message.guild);
    await message.safeReply(
      result.ok ? t("forestFuss.started", { channel: `<#${result.channel.id}>` }) : result.message
    );
  },

  async interactionRun(interaction, data) {
    const result = await startSession({
      client: interaction.client,
      guild: interaction.guild,
      leader: interaction.member,
      settings: data.settings,
    });

    const t = interactionTranslator(interaction, data.settings);
    await interaction.safeFollowUp(
      result.ok ? t("forestFuss.started", { channel: `<#${result.channel.id}>` }) : result.message
    );
  },
};
