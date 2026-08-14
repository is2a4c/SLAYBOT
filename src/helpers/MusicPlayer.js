const { PermissionFlagsBits } = require("discord.js");
const { waitForVoiceConnection } = require("./VoiceConnection");
const { loadTracks, normalizeLoadResult, toError, toQueueTrack } = require("./LavalinkUtils");
const { searchIdentifier } = require("@src/services/music/policy");

const VOICE_PERMISSIONS = [
  [PermissionFlagsBits.ViewChannel, "View Channel"],
  [PermissionFlagsBits.Connect, "Connect"],
  [PermissionFlagsBits.Speak, "Speak"],
];

function getMissingVoicePermissions(voiceChannel, botMember) {
  const permissions = voiceChannel.permissionsFor(botMember);
  return VOICE_PERMISSIONS.filter(([permission]) => !permissions?.has(permission)).map(([, label]) => label);
}

async function connectMusicPlayer({ manager, guildId, voiceChannel, textChannel, logger, timeoutMs }) {
  let player = manager.getPlayer(guildId);
  const excludedNodeIdentifiers = new Set();
  const maxAttempts = Math.max(1, manager.nodes?.size || 1);
  let lastError;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      player ||= manager.createPlayer(guildId, { excludedNodeIdentifiers });
      player.queue.data.channel = textChannel;

      logger?.log(
        `Music voice connect requested for guild=${guildId}, channel=${voiceChannel.id}, node=${player.node.identifier}`
      );
      await player.connect(voiceChannel.id, { deafened: true });
      await waitForVoiceConnection(player, voiceChannel.id, { timeoutMs });
      logger?.log(
        `Music voice connected for guild=${guildId}, channel=${voiceChannel.id}, node=${player.node.identifier}`
      );
      return player;
    } catch (error) {
      lastError = toError(error);
      const failedNodeIdentifier = player?.node?.identifier;
      if (failedNodeIdentifier) excludedNodeIdentifiers.add(failedNodeIdentifier);
      logger?.error(
        `Music voice connection failed for guild=${guildId}, channel=${voiceChannel.id}, node=${failedNodeIdentifier || "unknown"}`,
        lastError
      );

      await Promise.resolve(player?.disconnect()).catch(() => {});
      await manager.destroyPlayer(guildId).catch(() => {});
      player = null;
    }
  }

  throw lastError || new Error("No Lavalink nodes are available");
}

async function skipCurrentTrack(player) {
  const queue = player.queue;
  if (!queue.current) return { skipped: false, finished: false };

  const skipped = queue.current;
  if (queue.tracks.length > 0) {
    await queue.next();
    return { skipped: true, finished: false, track: skipped };
  }

  await player.stop();
  queue.last = skipped;
  queue.current = null;
  queue.emit("finish");
  return { skipped: true, finished: true, track: skipped };
}

async function setBassBoost(player, gain) {
  const equalizer = Array.from({ length: 15 }, (_, band) => ({
    band,
    gain: band < 3 ? gain : 0,
  }));
  await player.setFilters("equalizer", equalizer);
}

/**
 * Keep a server's music channel from going quiet: when a server has autoplay
 * configured, load its query in place of stopping and disconnecting.
 *
 * Never throws - a bad query, a channel that is gone, or Lavalink refusing the
 * search all fall back to the caller's own "queue has ended" handling, the same
 * way as if autoplay had never been configured.
 *
 * @param {Object} input
 * @param {object} input.manager the music manager (`client.musicManager`)
 * @param {import('discord.js').Guild} input.guild
 * @param {object} input.queue the finished player's queue
 * @param {object} input.config `control_center.music`
 * @param {object} [input.settings] guild settings document, for the server's search source
 * @param {object} [input.logger]
 * @returns {Promise<boolean>} true when autoplay actually started something
 */
async function startAutoplay({ manager, guild, queue, config, settings, logger }) {
  const query = String(config?.autoplay_query || "").trim();
  if (!query) return false;

  const configuredChannel = config.autoplay_output_channel && guild.channels.cache.get(config.autoplay_output_channel);
  const outputChannel =
    configuredChannel?.isTextBased?.() && !configuredChannel.isThread?.() ? configuredChannel : queue.data.channel;
  if (!outputChannel?.isTextBased?.() || outputChannel.isThread?.()) return false;

  try {
    const result = normalizeLoadResult(await loadTracks(manager, searchIdentifier(query, settings)));
    const tracks = (result.tracks || []).map(toQueueTrack).filter((track) => track?.track && track?.info);
    if (!tracks.length) {
      logger?.warn?.(`Music autoplay: no results for "${query}" in guild=${guild.id}`);
      return false;
    }

    const track = tracks[Math.floor(Math.random() * tracks.length)];
    queue.data.channel = outputChannel;
    queue.add([track], { requester: "Autoplay", next: false });
    await queue.start();
    return true;
  } catch (error) {
    logger?.error?.(`Music autoplay failed in guild=${guild.id}`, toError(error));
    return false;
  }
}

module.exports = {
  connectMusicPlayer,
  getMissingVoicePermissions,
  setBassBoost,
  skipCurrentTrack,
  startAutoplay,
};
