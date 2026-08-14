const {
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ApplicationCommandOptionType,
  ComponentType,
} = require("discord.js");
const prettyMs = require("pretty-ms");
const { EMBED_COLORS, MUSIC } = require("@root/config");
const { hasAvailableNode, loadTracks, normalizeLoadResult, toError, toQueueTrack } = require("@helpers/LavalinkUtils");
const { connectMusicPlayer, getMissingVoicePermissions } = require("@helpers/MusicPlayer");
const { applyQueueLimits, noticeSeconds, searchIdentifier } = require("@src/services/music/policy");

/**
 * @type {import("@structures/Command")}
 */
module.exports = {
  name: "search",
  description: "search for matching songs on youtube",
  category: "MUSIC",
  botPermissions: ["EmbedLinks"],
  command: {
    enabled: true,
    usage: "<song-name>",
    minArgsCount: 1,
  },
  slashCommand: {
    enabled: true,
    options: [
      {
        name: "query",
        description: "song to search",
        type: ApplicationCommandOptionType.String,
        required: true,
      },
    ],
  },

  async messageRun(message, args, data) {
    const query = args.join(" ");
    const response = await search(message, query, data?.settings);
    if (response)
      await message.safeReply(response, typeof response === "object" ? noticeSeconds(data?.settings) : undefined);
  },

  async interactionRun(interaction, { settings } = {}) {
    const query = interaction.options.getString("query");
    const response = await search(interaction, query, settings);
    if (response)
      await interaction.safeFollowUp(response, typeof response === "object" ? noticeSeconds(settings) : undefined);
    else interaction.deleteReply().catch(() => {});
  },
};

/**
 * @param {import("discord.js").CommandInteraction|import("discord.js").Message} arg0
 * @param {string} query
 * @param {object} [settings] guild settings document
 */
async function search({ member, guild, channel }, query, settings) {
  if (!member.voice.channel) return "🚫 You need to join a voice channel first";

  const musicManager = guild.client.musicManager;
  if (!musicManager) return "🚫 Music system is not available. Try again later";
  if (!hasAvailableNode(musicManager))
    return "🚫 Music system is temporarily unavailable. No Lavalink node is connected";

  const voiceChannel = member.voice.channel;
  const missingVoicePermissions = getMissingVoicePermissions(voiceChannel, guild.members.me);
  if (missingVoicePermissions.length) {
    return `🚫 I need these permissions in ${voiceChannel}: ${missingVoicePermissions.join(", ")}`;
  }

  let player = musicManager.getPlayer(guild.id);
  if (player && !guild.members.me.voice.channel) {
    await Promise.resolve(player.disconnect()).catch(() => {});
    await musicManager.destroyPlayer(guild.id);
    player = null;
  }
  if (player && member.voice.channelId !== guild.members.me.voice.channelId) {
    return "🚫 You must be in the same voice channel as mine";
  }

  let res;
  try {
    res = normalizeLoadResult(await loadTracks(musicManager, searchIdentifier(query, settings, MUSIC.DEFAULT_SOURCE)));
  } catch (err) {
    guild.client.logger.error("Search Exception", toError(err));
    return "🚫 There was an error while searching";
  }

  let embed = new EmbedBuilder().setColor(EMBED_COLORS.BOT_EMBED);
  let tracks;

  const loadType = res.tracks.length > 0 ? res.loadType : "NO_MATCHES";
  switch (loadType) {
    case "LOAD_FAILED":
      guild.client.logger.error("Search Exception", new Error(res.exception?.message || "Unknown error"));
      return "🚫 There was an error while searching";

    case "NO_MATCHES":
      return `No results found matching ${query}`;

    case "TRACK_LOADED": {
      const [track] = res.tracks;
      tracks = [track];
      if (!player?.playing && !player?.paused && !player?.queue.tracks.length) {
        embed.setAuthor({ name: "Added Song to queue" });
        break;
      }

      const fields = [];
      embed
        .setAuthor({ name: "Added Song to queue" })
        .setDescription(`[${track.info.title}](${track.info.uri})`)
        .setFooter({ text: `Requested By: ${member.user.username}` });

      fields.push({
        name: "Song Duration",
        value: "`" + prettyMs(track.info.length, { colonNotation: true }) + "`",
        inline: true,
      });

      // if (typeof track.displayThumbnail === "function") embed.setThumbnail(track.displayThumbnail("hqdefault"));
      if (player?.queue?.tracks?.length > 0) {
        fields.push({
          name: "Position in Queue",
          value: (player.queue.tracks.length + 1).toString(),
          inline: true,
        });
      }
      embed.addFields(fields);
      break;
    }

    case "PLAYLIST_LOADED":
      tracks = res.tracks;
      embed
        .setAuthor({ name: "Added Playlist to queue" })
        .setDescription(res.playlistInfo.name)
        .addFields(
          {
            name: "Enqueued",
            value: `${res.tracks.length} songs`,
            inline: true,
          },
          {
            name: "Playlist duration",
            value:
              "`" +
              prettyMs(
                res.tracks.map((t) => t.info.length).reduce((a, b) => a + b, 0),
                { colonNotation: true }
              ) +
              "`",
            inline: true,
          }
        )
        .setFooter({ text: `Requested By: ${member.user.username}` });
      break;

    case "SEARCH_RESULT": {
      let max = Number.parseInt(guild.client.config.MUSIC.MAX_SEARCH_RESULTS, 10);
      if (!Number.isInteger(max) || max < 1) max = 10;
      max = Math.min(max, 25, res.tracks.length);

      const results = res.tracks.slice(0, max);
      const options = results.map((result, index) => ({
        label: result.info.title.length > 100 ? result.info.title.slice(0, 97) + "..." : result.info.title, // Truncate title
        value: index.toString(),
      }));

      const menuRow = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId("search-results")
          .setPlaceholder("Choose Search Results")
          .setMaxValues(max)
          .addOptions(options)
      );

      const tempEmbed = new EmbedBuilder()
        .setColor(EMBED_COLORS.BOT_EMBED)
        .setAuthor({ name: "Search Results" })
        .setDescription(`Please select the songs you wish to add to queue`);

      const sentMsg = await channel.send({
        embeds: [tempEmbed],
        components: [menuRow],
      });

      try {
        const response = await channel.awaitMessageComponent({
          filter: (reactor) =>
            reactor.customId === "search-results" && reactor.message.id === sentMsg.id && reactor.user.id === member.id,
          time: 30 * 1000,
          componentType: ComponentType.StringSelect,
        });

        await response.deferUpdate();
        await sentMsg.delete().catch(() => {});

        const toAdd = [];
        response.values.forEach((v) => toAdd.push(results[v]));

        // Only 1 song is selected
        if (toAdd.length === 1) {
          tracks = [toAdd[0]];
          embed.setAuthor({ name: "Added Song to queue" });
        } else {
          tracks = toAdd;
          embed
            .setDescription(`🎶 Added ${toAdd.length} songs to queue`)
            .setFooter({ text: `Requested By: ${member.user.username}` });
        }
      } catch (err) {
        await sentMsg.delete().catch(() => {});
        if (err?.message?.includes("time")) return "🚫 You took too long to select the songs";
        guild.client.logger.error("Search selection", toError(err));
        return "🚫 Failed to register your response";
      }
    }
  }

  if (!tracks) return "🚫 An error occurred while searching";
  tracks = tracks.map(toQueueTrack).filter((track) => track?.track && track?.info);
  if (!tracks.length) return "🚫 No playable tracks were found";

  const limited = applyQueueLimits(tracks, settings, {
    existingTracks: player?.queue?.tracks || [],
    requesterName: member.user.username,
  });
  tracks = limited.tracks;
  if (!tracks.length) {
    if (limited.droppedForQuota) return "🚫 You already have as many tracks queued as this server allows";
    return "🚫 Every matching track is longer than this server allows";
  }
  const skipped = limited.droppedForLength + limited.droppedForQuota;
  if (skipped > 0) {
    embed.addFields({
      name: "Skipped",
      value: [
        limited.droppedForLength && `${limited.droppedForLength} too long for this server`,
        limited.droppedForQuota && `${limited.droppedForQuota} over your queue limit`,
      ]
        .filter(Boolean)
        .join(", "),
    });
  }

  // create a player and/or join the member's vc
  if (!player?.connected) {
    try {
      player = await connectMusicPlayer({
        manager: musicManager,
        guildId: guild.id,
        voiceChannel,
        textChannel: channel,
        logger: guild.client.logger,
      });
    } catch {
      return "🚫 I could not connect to your voice channel. Check my channel permissions and try again";
    }
  } else {
    player.queue.data.channel = channel;
  }

  // do queue things
  const started = player.playing || player.paused;
  player.queue.add(tracks, { requester: member.user.username, next: false });
  if (!started) {
    await player.queue.start();
  }

  return { embeds: [embed] };
}
