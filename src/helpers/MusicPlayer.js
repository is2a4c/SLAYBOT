const { PermissionFlagsBits } = require("discord.js");
const { waitForVoiceConnection } = require("./VoiceConnection");
const { toError } = require("./LavalinkUtils");

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

module.exports = {
  connectMusicPlayer,
  getMissingVoicePermissions,
  setBassBoost,
  skipCurrentTrack,
};
