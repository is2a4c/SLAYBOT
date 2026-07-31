const { musicValidations } = require("@helpers/BotUtils");
const prettyMs = require("pretty-ms");
const { durationToMillis } = require("@helpers/Utils");
const { ApplicationCommandOptionType } = require("discord.js");

/**
 * @type {import("@structures/Command")}
 */
module.exports = {
  name: "seek",
  description: "sets the playing track's position to the specified position",
  category: "MUSIC",
  validations: musicValidations,
  command: {
    enabled: true,
    usage: "<duration>",
  },
  slashCommand: {
    enabled: true,
    options: [
      {
        name: "time",
        description: "The time you want to seek to.",
        type: ApplicationCommandOptionType.String,
        required: true,
      },
    ],
  },

  async messageRun(message, args) {
    const time = args.join(" ");
    const response = await seekTo(message, time);
    await message.safeReply(response);
  },

  async interactionRun(interaction) {
    const time = interaction.options.getString("time");
    const response = await seekTo(interaction, time);
    await interaction.safeFollowUp(response);
  },
};

/**
 * @param {import("discord.js").CommandInteraction|import("discord.js").Message} arg0
 * @param {number} time
 */
async function seekTo({ client, guildId }, time) {
  const player = client.musicManager?.getPlayer(guildId);
  const seekTo = durationToMillis(time);
  if (!Number.isFinite(seekTo) || seekTo < 0) return "Please provide a valid duration. Example: 1:30";
  if (!player?.queue?.current) return "There is no current track to seek";

  if (seekTo > player.queue.current.length) {
    return "The duration you provide exceeds the duration of the current track";
  }

  await player.seek(seekTo);
  return `Seeked to ${prettyMs(seekTo, { colonNotation: true, secondsDecimalDigits: 0 })}`;
}
