const { EMBED_COLORS } = require("@root/config");
const { EmbedBuilder } = require("discord.js");
const prettyMs = require("pretty-ms");
const { splitBar } = require("string-progressbar");
const { musicConfig } = require("@src/services/music/policy");

/**
 * @type {import("@structures/Command")}
 */
module.exports = {
  name: "np",
  description: "show's what track is currently being played",
  category: "MUSIC",
  botPermissions: ["EmbedLinks"],
  command: {
    enabled: true,
    aliases: ["nowplaying"],
  },
  slashCommand: {
    enabled: true,
  },

  async messageRun(message, args, data) {
    const response = nowPlaying(message, data?.settings);
    await message.safeReply(response);
  },

  async interactionRun(interaction, { settings } = {}) {
    const response = nowPlaying(interaction, settings);
    await interaction.safeFollowUp(response);
  },
};

/**
 * @param {import("discord.js").CommandInteraction|import("discord.js").Message} arg0
 * @param {object} [settings] guild settings document
 */
function nowPlaying({ client, guildId }, settings) {
  const player = client.musicManager.getPlayer(guildId);
  if (!player || !player.queue.current) return "🚫 No music is being played!";

  const track = player.queue.current;
  const end = track.length > 6.048e8 ? "🔴 LIVE" : new Date(track.length).toISOString().slice(11, 19);

  const fields = [
    {
      name: "Song Duration",
      value: "`" + prettyMs(track.length, { colonNotation: true }) + "`",
      inline: true,
    },
    {
      name: "Requested By",
      value: track.requester || "Unknown",
      inline: true,
    },
  ];

  if (musicConfig(settings)?.progress_bar !== false) {
    fields.push({
      name: "\u200b",
      value:
        new Date(player.position).toISOString().slice(11, 19) +
        " [" +
        splitBar(track.length > 6.048e8 ? player.position : track.length, player.position, 15)[0] +
        "] " +
        end,
      inline: false,
    });
  }

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLORS.BOT_EMBED)
    .setAuthor({ name: "Now playing" })
    .setDescription(`[${track.title}](${track.uri})`)
    .addFields(fields);

  return { embeds: [embed] };
}
