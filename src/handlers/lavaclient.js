const { EmbedBuilder } = require("discord.js");
const { Cluster } = require("lavaclient");
const prettyMs = require("pretty-ms");
const { splitBar } = require("string-progressbar");
const { load: loadSpotify, SpotifyItemType } = require("@lavaclient/spotify");
const { Queue, load: loadQueue } = require("@lavaclient/queue");
const { mayStartNext } = require("@lavaclient/types/v3");
const { getLavalinkNodes } = require("@helpers/LavalinkNodes");
const { getSettings } = require("@schemas/Guild");
const { musicConfig, noticeSeconds } = require("@src/services/music/policy");
const { startAutoplay } = require("@helpers/MusicPlayer");

Object.assign(mayStartNext, {
  finished: true,
  loadFailed: true,
  stopped: false,
  replaced: false,
  cleanup: false,
});

loadQueue((player) => {
  return new Queue(player, {
    play: async (_queue, song) => {
      await player.play(song.track);
    },
  });
});

/**
 * @param {import("@structures/BotClient")} client
 */
module.exports = (client) => {
  loadSpotify({
    client: {
      id: process.env.SPOTIFY_CLIENT_ID,
      secret: process.env.SPOTIFY_CLIENT_SECRET,
    },
    autoResolveYoutubeTracks: false,
    loaders: [SpotifyItemType.Album, SpotifyItemType.Artist, SpotifyItemType.Playlist, SpotifyItemType.Track],
  });

  const lavaclient = new Cluster({
    nodes: normalizeNodes(getLavalinkNodes(client.config.MUSIC.LAVALINK_NODES), client),
    discord: {
      userId: client.user.id,
      sendGatewayCommand: (id, payload) => client.guilds.cache.get(id)?.shard?.send(payload),
    },
  });

  addLegacyPlayerAliases(lavaclient, client);

  client.ws.on("VOICE_SERVER_UPDATE", (data) => lavaclient.handleVoiceUpdate(data));
  client.ws.on("VOICE_STATE_UPDATE", (data) => lavaclient.handleVoiceUpdate(data));

  lavaclient.on("nodeConnected", (node, event) => {
    client.logger.log(`Node "${node.identifier}" connected`);
  });

  lavaclient.on("nodeDisconnected", (node, event) => {
    client.logger.log(`Node "${node.identifier}" disconnected`);
  });

  lavaclient.on("nodeError", (node, error) => {
    client.logger.error(`Node "${node.identifier}" encountered an error: ${error.message}.`, error);
  });

  lavaclient.on("nodeDebug", (node, event) => {
    client.logger.debug(`Node "${node.identifier}" debug: ${event.message || event}`);
  });

  lavaclient.on("nodeTrackStart", async (_node, queue, song) => {
    const guild = client.guilds.cache.get(queue.player.id);
    const settings = guild ? await getSettings(guild).catch(() => null) : null;
    const config = musicConfig(settings);

    const fields = [];

    const embed = new EmbedBuilder()
      .setAuthor({ name: "Now Playing" })
      .setColor(client.config.EMBED_COLORS.BOT_EMBED)
      .setDescription(`[${song.title}](${song.uri})`)
      .setFooter({ text: `Requested By: ${song.requester}` });

    if (song.sourceName === "youtube") {
      const identifier = song.identifier;
      const thumbnail = `https://img.youtube.com/vi/${identifier}/hqdefault.jpg`;
      embed.setThumbnail(thumbnail);
    }

    fields.push({
      name: "Song Duration",
      value: "`" + prettyMs(song.length, { colonNotation: true }) + "`",
      inline: true,
    });

    if (queue.tracks.length > 0) {
      fields.push({
        name: "Position in Queue",
        value: (queue.tracks.length + 1).toString(),
        inline: true,
      });
    }

    // A live stream has no real length to bar against, and `song.length` for
    // one is a placeholder Discord would render as a nonsense timestamp.
    if (config?.progress_bar !== false && song.length < 6.048e8) {
      const [bar] = splitBar(song.length, 0, 20);
      fields.push({
        name: "Progress",
        value: `\`00:00\` ${bar} \`${prettyMs(song.length, { colonNotation: true })}\``,
      });
    }

    embed.setFields(fields);
    await queue.data.channel?.safeSend({ embeds: [embed] }, noticeSeconds(settings)).catch((error) => {
      client.logger.warn(`Could not send the now-playing message: ${error.message}`);
    });
  });

  lavaclient.on("nodeQueueFinish", async (_node, queue) => {
    const guild = client.guilds.cache.get(queue.player.id);
    const settings = guild ? await getSettings(guild).catch(() => null) : null;
    const config = musicConfig(settings);

    if (guild && config?.autoplay_enabled) {
      const restarted = await startAutoplay({
        manager: client.musicManager,
        guild,
        queue,
        config,
        settings,
        logger: client.logger,
      });
      if (restarted) return;
    }

    await queue.data.channel?.safeSend("Queue has ended.", noticeSeconds(settings)).catch((error) => {
      client.logger.warn(`Could not send the queue-finished message: ${error.message}`);
    });

    await Promise.resolve(queue.player.disconnect()).catch(() => {});
    if (client.musicManager.getPlayer(queue.player.id) === queue.player) {
      await client.musicManager
        .destroyPlayer(queue.player.id)
        .catch((error) => client.logger.error("Could not destroy the finished music player", error));
    }
  });

  lavaclient.connect();
  return lavaclient;
};

function normalizeNodes(nodes, client) {
  return nodes.map((node) => {
    if (node.info) return node;

    let host = node.host;
    let port = node.port;
    let tls = Boolean(node.secure);

    if (/^https?:\/\//i.test(host) || /^wss?:\/\//i.test(host)) {
      try {
        const url = new URL(host);
        if (url.pathname && url.pathname !== "/") {
          client.logger.warn(
            `Lavalink node "${node.id || node.identifier || url.hostname}" has a URL path; only host, port and protocol are used`
          );
        }

        host = url.hostname;
        port = port || Number(url.port) || (url.protocol === "https:" || url.protocol === "wss:" ? 443 : 80);
        tls = node.secure ?? (url.protocol === "https:" || url.protocol === "wss:");
      } catch (ex) {
        client.logger.warn(`Invalid Lavalink node host "${node.host}". Using it as configured`);
      }
    }

    return {
      identifier: node.identifier || node.id || `${host}:${port}`,
      info: {
        host,
        port,
        auth: node.password,
        tls,
      },
    };
  });
}

function addLegacyPlayerAliases(lavaclient, client) {
  lavaclient.getPlayer = (guildId) => wrapLegacyPlayer(lavaclient.players.resolve(guildId));
  lavaclient.createPlayer = (guildId, options = {}) => {
    const existing = lavaclient.players.resolve(guildId);
    if (existing) return wrapLegacyPlayer(existing);

    const excluded = new Set(options.excludedNodeIdentifiers || []);
    if (!excluded.size) return wrapLegacyPlayer(lavaclient.players.create(guildId));

    const node = selectFallbackNode(lavaclient.nodes.values(), excluded);

    if (!node) throw new Error("No fallback Lavalink nodes available");
    return wrapLegacyPlayer(node.players.create(guildId));
  };
  lavaclient.destroyPlayer = (guildId) => lavaclient.players.destroy(guildId, true);
  lavaclient.handleVoiceUpdate = (data) => {
    const player = lavaclient.players.resolve(data.guild_id);
    if (player) player.voice.handleVoiceUpdate(data).catch((ex) => client.logger.error("Lavalink voice update", ex));
  };
}

function wrapLegacyPlayer(player) {
  if (!player || player._legacyAliasesAdded) return player;

  player.connect = (channel, options) => player.voice.connect(channel, options);
  player.disconnect = () => player.voice.disconnect();
  Object.defineProperty(player, "connected", {
    get() {
      return player.voice.connected;
    },
  });
  Object.defineProperty(player, "channelId", {
    get() {
      return player.voice.channelId;
    },
  });
  player._legacyAliasesAdded = true;
  return player;
}

function selectFallbackNode(nodes, excludedNodeIdentifiers) {
  return [...nodes]
    .filter((candidate) => candidate.ws.active && !excludedNodeIdentifiers.has(candidate.identifier))
    .sort((left, right) => left.penalties.calculate() - right.penalties.calculate())[0];
}

module.exports.selectFallbackNode = selectFallbackNode;
