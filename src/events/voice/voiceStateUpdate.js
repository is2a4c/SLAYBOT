const { trackVoiceStats } = require("@handlers/stats");
const { voiceRoleHandler } = require("@src/handlers");
const { getSettings } = require("@schemas/Guild");

const musicIdleTimers = new Map();

/**
 * @param {import('@src/structures').BotClient} client
 * @param {import('discord.js').VoiceState} oldState
 * @param {import('discord.js').VoiceState} newState
 */
module.exports = async (client, oldState, newState) => {
  // Track voice stats
  trackVoiceStats(oldState, newState).catch((ex) => client.logger.error("trackVoiceStats", ex));

  // Voice roles - only when the channel actually changed
  if (oldState.channelId !== newState.channelId) {
    const guild = newState.guild || oldState.guild;
    getSettings(guild)
      .then((settings) => voiceRoleHandler.handleVoiceStateUpdate(oldState, newState, settings))
      .catch((ex) => client.logger.error("voiceRoles", ex));
  }

  // Lavalink
  if (client.config.MUSIC.enabled && client.musicManager) {
    handleMusicIdleState(client, oldState, newState);
  }
};

function handleMusicIdleState(client, oldState, newState) {
  const guild = newState.guild || oldState.guild;
  const botChannel = guild.members.me.voice.channel;
  const existingTimer = musicIdleTimers.get(guild.id);

  if (!botChannel) {
    if (existingTimer) clearTimeout(existingTimer);
    musicIdleTimers.delete(guild.id);
    return;
  }

  if (oldState.channelId !== botChannel.id && newState.channelId !== botChannel.id) return;

  if (botChannel.members.size > 1) {
    if (existingTimer) clearTimeout(existingTimer);
    musicIdleTimers.delete(guild.id);
    return;
  }

  if (existingTimer) return;

  const timer = setTimeout(async () => {
    musicIdleTimers.delete(guild.id);
    const currentChannel = guild.members.me.voice.channel;
    if (!currentChannel || currentChannel.id !== botChannel.id || currentChannel.members.size > 1) return;

    const player = client.musicManager.getPlayer(guild.id);
    if (!player) return;

    await Promise.resolve(player.disconnect()).catch(() => {});
    await client.musicManager
      .destroyPlayer(guild.id)
      .catch((error) => client.logger.error("Could not destroy idle music player", error));
  }, client.config.MUSIC.IDLE_TIME * 1000);

  musicIdleTimers.set(guild.id, timer);
}

module.exports.handleMusicIdleState = handleMusicIdleState;
module.exports.musicIdleTimers = musicIdleTimers;
