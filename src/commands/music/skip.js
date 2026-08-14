const { musicValidations } = require("@helpers/BotUtils");
const { skipCurrentTrack } = require("@helpers/MusicPlayer");
const { noticeSeconds } = require("@src/services/music/policy");

/**
 * @type {import("@structures/Command")}
 */
module.exports = {
  name: "skip",
  description: "skip the current song",
  category: "MUSIC",
  validations: musicValidations,
  command: {
    enabled: true,
    aliases: ["next"],
  },
  slashCommand: {
    enabled: true,
  },

  async messageRun(message, args, data) {
    const response = await skip(message);
    await message.safeReply(response, typeof response === "object" ? noticeSeconds(data?.settings) : undefined);
  },

  async interactionRun(interaction, { settings } = {}) {
    const response = await skip(interaction);
    await interaction.safeFollowUp(response, typeof response === "object" ? noticeSeconds(settings) : undefined);
  },
};

/**
 * @param {import("discord.js").CommandInteraction|import("discord.js").Message} arg0
 */
async function skip({ client, guildId }) {
  const player = client.musicManager.getPlayer(guildId);

  // check if current song is playing
  if (!player.queue.current) return "⏯️ There is no song currently being played";

  const { title } = player.queue.current;
  await skipCurrentTrack(player);
  return { content: `⏯️ ${title} was skipped.` };
}
