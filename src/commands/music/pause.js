const { musicValidations } = require("@helpers/BotUtils");

/**
 * @type {import("@structures/Command")}
 */
module.exports = {
  name: "pause",
  description: "pause the music player",
  category: "MUSIC",
  validations: musicValidations,
  command: {
    enabled: true,
  },
  slashCommand: {
    enabled: true,
  },

  async messageRun(message, args) {
    const response = await pause(message);
    await message.safeReply(response);
  },

  async interactionRun(interaction) {
    const response = await pause(interaction);
    await interaction.followUp(response);
  },
};

/**
 * @param {import("discord.js").CommandInteraction|import("discord.js").Message} arg0
 */
async function pause({ client, guildId }) {
  const player = client.musicManager.getPlayer(guildId);
  if (player.paused) return "The player is already paused.";

  await player.pause(true);
  return "⏸️ Paused the music player.";
}
