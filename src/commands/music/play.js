const { EmbedBuilder, ApplicationCommandOptionType } = require("discord.js");
const prettyMs = require("pretty-ms");
const { EMBED_COLORS, MUSIC } = require("@root/config");
const { SpotifyItemType } = require("@lavaclient/spotify");
const { loadTracks, normalizeLoadResult, toError, toQueueTrack } = require("@helpers/LavalinkUtils");
const { connectMusicPlayer, getMissingVoicePermissions } = require("@helpers/MusicPlayer");

const search_prefix = {
  YT: "ytsearch",
  YTM: "ytmsearch",
  SC: "scsearch",
};

/**
 * @type {import("@structures/Command")}
 */
module.exports = {
  name: "play",
  description: "play a song from youtube",
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
        description: "song name or url",
        type: ApplicationCommandOptionType.String,
        required: true,
      },
    ],
  },

  async messageRun(message, args) {
    const query = args.join(" ");
    const response = await play(message, query);
    await message.safeReply(response);
  },

  async interactionRun(interaction) {
    const query = interaction.options.getString("query");
    const response = await play(interaction, query);
    await interaction.safeFollowUp(response);
  },
};

/**
 * @param {import("discord.js").CommandInteraction|import("discord.js").Message} arg0
 * @param {string} query
 */
async function play({ member, guild, channel }, query) {
  if (!member.voice.channel) return "🚫 You need to join a voice channel first";

  const mm = guild.client.musicManager;
  if (!mm) return "🚫 Music system is not available. Try again later";

  const voiceChannel = member.voice.channel;
  const missingVoicePermissions = getMissingVoicePermissions(voiceChannel, guild.members.me);

  if (missingVoicePermissions.length) {
    return `🚫 I need these permissions in ${voiceChannel}: ${missingVoicePermissions.join(", ")}`;
  }

  let player = mm.getPlayer(guild.id);
  if (player && !guild.members.me.voice.channel) {
    await Promise.resolve(player.disconnect()).catch(() => {});
    await mm.destroyPlayer(guild.id);
    player = null;
  }

  if (player && member.voice.channelId !== guild.members.me.voice.channelId) {
    return "🚫 You must be in the same voice channel as mine";
  }

  let embed = new EmbedBuilder().setColor(EMBED_COLORS.BOT_EMBED);
  let tracks;
  let description = "";

  try {
    if (mm.spotify.isSpotifyUrl(query)) {
      if (!process.env.SPOTIFY_CLIENT_ID || !process.env.SPOTIFY_CLIENT_SECRET) {
        return "🚫 Spotify songs cannot be played. Please contact the bot owner";
      }

      const item = await mm.spotify.load(query);
      switch (item?.type) {
        case SpotifyItemType.Track: {
          const track = await item.resolveYoutubeTrack();
          tracks = [track];
          description = `[${track.info.title}](${track.info.uri})`;
          break;
        }

        case SpotifyItemType.Artist:
          tracks = await item.resolveYoutubeTracks();
          description = `Artist: [**${item.name}**](${query})`;
          break;

        case SpotifyItemType.Album:
          tracks = await item.resolveYoutubeTracks();
          description = `Album: [**${item.name}**](${query})`;
          break;

        case SpotifyItemType.Playlist:
          tracks = await item.resolveYoutubeTracks();
          description = `Playlist: [**${item.name}**](${query})`;
          break;

        default:
          return "🚫 An error occurred while searching for the song";
      }

      if (!tracks) guild.client.logger.debug({ query, item });
    } else {
      const res = normalizeLoadResult(
        await loadTracks(mm, /^https?:\/\//.test(query) ? query : `${search_prefix[MUSIC.DEFAULT_SOURCE]}:${query}`)
      );

      switch (res.loadType) {
        case "LOAD_FAILED":
          guild.client.logger.error("Search Exception", new Error(res.exception?.message || "Unknown error"));
          return "🚫 There was an error while searching: " + (res.exception?.message || "Unknown error");

        case "NO_MATCHES":
          return `No results found matching ${query}`;

        case "PLAYLIST_LOADED":
          tracks = res.tracks;
          description = res.playlistInfo.name;
          break;

        case "TRACK_LOADED":
        case "SEARCH_RESULT": {
          const [track] = res.tracks;
          tracks = [track];
          break;
        }

        default:
          guild.client.logger.debug("Unknown loadType", res.message);
          return "🚫 An error occurred while searching for the song";
      }

      if (!tracks) guild.client.logger.debug({ query, res });
    }
  } catch (error) {
    guild.client.logger.error("Search Exception", toError(error));
    return "🚫 An error occurred while searching for the song";
  }

  if (!tracks) return "🚫 An error occurred while searching for the song";
  tracks = tracks.map(toQueueTrack).filter((track) => track?.track && track?.info);
  if (!tracks.length) return "🚫 No playable tracks were found";

  if (tracks.length === 1) {
    const track = tracks[0];
    if (!player?.playing && !player?.paused && !player?.queue.tracks.length) {
      embed.setAuthor({ name: "Added Track to queue" });
    } else {
      const fields = [];
      embed
        .setAuthor({ name: "Added Track to queue" })
        .setDescription(`[${track.info.title}](${track.info.uri})`)
        .setFooter({ text: `Requested By: ${member.user.username}` });

      fields.push({
        name: "Song Duration",
        value: "`" + prettyMs(track.info.length, { colonNotation: true }) + "`",
        inline: true,
      });

      if (player?.queue?.tracks?.length > 0) {
        fields.push({
          name: "Position in Queue",
          value: (player.queue.tracks.length + 1).toString(),
          inline: true,
        });
      }
      embed.addFields(fields);
    }
  } else {
    embed
      .setAuthor({ name: "Added Playlist to queue" })
      .setDescription(description)
      .addFields(
        {
          name: "Enqueued",
          value: `${tracks.length} songs`,
          inline: true,
        },
        {
          name: "Playlist duration",
          value:
            "`" +
            prettyMs(
              tracks.map((t) => t.info.length).reduce((a, b) => a + b, 0),
              { colonNotation: true }
            ) +
            "`",
          inline: true,
        }
      )
      .setFooter({ text: `Requested By: ${member.user.username}` });
  }

  // create a player and/or join the member's vc
  if (!player?.connected) {
    try {
      player = await connectMusicPlayer({
        manager: mm,
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
