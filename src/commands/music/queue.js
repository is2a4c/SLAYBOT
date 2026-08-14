const { EMBED_COLORS } = require("@root/config");
const { EmbedBuilder, ApplicationCommandOptionType } = require("discord.js");
const prettyMs = require("pretty-ms");
const { musicConfig } = require("@src/services/music/policy");

/**
 * @type {import("@structures/Command")}
 */
module.exports = {
  name: "queue",
  description: "displays the current music queue",
  category: "MUSIC",
  botPermissions: ["EmbedLinks"],
  command: {
    enabled: true,
    usage: "[page]",
  },
  slashCommand: {
    enabled: true,
    options: [
      {
        name: "page",
        description: "page number",
        type: ApplicationCommandOptionType.Integer,
        required: false,
      },
    ],
  },

  async messageRun(message, args, data) {
    const page = args.length && Number(args[0]) ? Number(args[0]) : 1;
    const response = getQueue(message, page, data?.settings);
    await message.safeReply(response);
  },

  async interactionRun(interaction, { settings } = {}) {
    const page = interaction.options.getInteger("page");
    const response = getQueue(interaction, page, settings);
    await interaction.safeFollowUp(response);
  },
};

/**
 * One line of the queue: just the title when the server keeps it compact, or
 * the title with its duration and who asked for it otherwise.
 *
 * @param {object} track
 * @param {number} index
 * @param {boolean} compact
 */
function lineFor(track, index, compact) {
  const title = `${index} - [${track.title}](${track.uri})`;
  if (compact) return title;
  return `${title} \`${prettyMs(track.length, { colonNotation: true })}\` — ${track.requester || "Unknown"}`;
}

/**
 * @param {import("discord.js").CommandInteraction|import("discord.js").Message} arg0
 * @param {number} pgNo
 * @param {object} [settings] guild settings document
 */
function getQueue({ client, guild }, pgNo, settings) {
  const player = client.musicManager.getPlayer(guild.id);
  if (!player) return "🚫 There is no music playing in this guild.";

  const queue = player.queue;
  const compact = musicConfig(settings)?.compact_queue !== false;
  const embed = new EmbedBuilder().setColor(EMBED_COLORS.BOT_EMBED).setAuthor({ name: `Queue for ${guild.name}` });

  // change for the amount of tracks per page
  const multiple = 10;
  const page = Number.isInteger(pgNo) && pgNo > 0 ? pgNo : 1;

  const end = page * multiple;
  const start = end - multiple;

  const tracks = queue.tracks.slice(start, end);

  if (queue.current) {
    embed.addFields({
      name: "Current",
      value: compact
        ? `[${queue.current.title}](${queue.current.uri})`
        : `[${queue.current.title}](${queue.current.uri}) \`${prettyMs(queue.current.length, { colonNotation: true })}\` — ${queue.current.requester || "Unknown"}`,
    });
  }
  if (!tracks.length) embed.setDescription(`No tracks in ${page > 1 ? `page ${page}` : "the queue"}.`);
  else embed.setDescription(tracks.map((track, i) => lineFor(track, start + ++i, compact)).join("\n"));

  const maxPages = Math.max(1, Math.ceil(queue.tracks.length / multiple));

  embed.setFooter({ text: `Page ${page > maxPages ? maxPages : page} of ${maxPages}` });

  return { embeds: [embed] };
}
