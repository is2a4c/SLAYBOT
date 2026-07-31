const { EmbedBuilder, ApplicationCommandOptionType } = require("discord.js");
const { getJson } = require("@helpers/HttpUtils");
const { MESSAGES, EMBED_COLORS } = require("@root/config");

const BASE_URL = "https://lrclib.net/api/search";
const USER_AGENT = "SLAYBOT/2.1 (https://github.com/PashaBritva/SLAYBOT)";

/**
 * @type {import("@structures/Command")}
 */
module.exports = {
  name: "lyric",
  description: "find lyric of the song",
  category: "MUSIC",
  botPermissions: ["EmbedLinks"],
  command: {
    enabled: true,
    minArgsCount: 1,
    usage: "<Song Title - singer>",
  },
  slashCommand: {
    enabled: true,
    options: [
      {
        name: "query",
        type: ApplicationCommandOptionType.String,
        description: "find lyric of the song",
        required: true,
      },
    ],
  },

  async messageRun(message, args) {
    const choice = args.join(" ");
    if (!choice) {
      return message.safeReply("Invalid Lyric selected.");
    }
    const response = await getLyric(message.author, choice);
    return message.safeReply(response);
  },

  async interactionRun(interaction) {
    const choice = interaction.options.getString("query");
    const response = await getLyric(interaction.user, choice);
    await interaction.safeFollowUp(response);
  },
};

async function getLyric(user, choice) {
  const response = await getJson(`${BASE_URL}?q=${encodeURIComponent(choice)}`, {
    headers: { "User-Agent": USER_AGENT },
  });
  if (!response.success) return MESSAGES.API_ERROR;

  const result = Array.isArray(response.data) ? response.data.find((item) => item.plainLyrics) : null;
  if (!result) return `No lyrics found matching ${choice}`;

  const title = [result.artistName, result.trackName].filter(Boolean).join(" - ").slice(0, 256);
  const lyrics =
    result.plainLyrics.length > 4096 ? result.plainLyrics.slice(0, 4093).trimEnd() + "..." : result.plainLyrics;

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLORS.BOT_EMBED)
    .setTitle(title || choice.slice(0, 256))
    .setDescription(lyrics)
    .setFooter({ text: `Request By: ${user.username}` });

  return { embeds: [embed] };
}
