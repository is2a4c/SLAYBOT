const { EmbedBuilder } = require("discord.js");
const { Cluster } = require("lavaclient");
const prettyMs = require("pretty-ms");
const { load, SpotifyItemType } = require("@lavaclient/spotify");
require("@lavaclient/queue/register");

/**
 * @param {import("@structures/BotClient")} client
 */
module.exports = (client) => {
  load({
    client: {
      id: process.env.SPOTIFY_CLIENT_ID,
      secret: process.env.SPOTIFY_CLIENT_SECRET,
    },
    autoResolveYoutubeTracks: false,
    loaders: [SpotifyItemType.Album, SpotifyItemType.Artist, SpotifyItemType.Playlist, SpotifyItemType.Track],
  });

  const lavaclient = new Cluster({
    nodes: normalizeNodes(client.config.MUSIC.LAVALINK_NODES, client),
    sendGatewayPayload: (id, payload) => client.guilds.cache.get(id)?.shard?.send(payload),
    userId: client.user.id,
  });

  client.ws.on("VOICE_SERVER_UPDATE", (data) => lavaclient.handleVoiceUpdate(data));
  client.ws.on("VOICE_STATE_UPDATE", (data) => lavaclient.handleVoiceUpdate(data));

  lavaclient.on("nodeConnect", (node, event) => {
    client.logger.log(`Node "${node.id}" connected`);
  });

  lavaclient.on("nodeDisconnect", (node, event) => {
    client.logger.log(`Node "${node.id}" disconnected`);
  });

  lavaclient.on("nodeError", (node, error) => {
    client.logger.error(`Node "${node.id}" encountered an error: ${error.message}.`, error);
  });

  lavaclient.on("nodeDebug", (node, message) => {
    client.logger.debug(`Node "${node.id}" debug: ${message}`);
  });

  lavaclient.on("nodeTrackStart", (_node, queue, song) => {
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

    embed.setFields(fields);
    queue.data.channel.safeSend({ embeds: [embed] });
  });

  lavaclient.on("nodeQueueFinish", async (_node, queue) => {
    queue.data.channel.safeSend("Queue has ended.");
    await client.musicManager.destroyPlayer(queue.player.guildId).then(queue.player.disconnect());
  });

  return lavaclient;
};

function normalizeNodes(nodes, client) {
  return nodes.map((node) => {
    if (!/^https?:\/\//i.test(node.host) && !/^wss?:\/\//i.test(node.host)) return node;

    try {
      const url = new URL(node.host);
      if (url.pathname && url.pathname !== "/") {
        client.logger.warn(
          `Lavalink node "${node.id || url.hostname}" has a URL path; only host, port and protocol are used`
        );
      }

      return {
        ...node,
        host: url.hostname,
        port: node.port || Number(url.port) || (url.protocol === "https:" || url.protocol === "wss:" ? 443 : 80),
        secure: node.secure ?? (url.protocol === "https:" || url.protocol === "wss:"),
      };
    } catch (ex) {
      client.logger.warn(`Invalid Lavalink node host "${node.host}". Using it as configured`);
      return node;
    }
  });
}
