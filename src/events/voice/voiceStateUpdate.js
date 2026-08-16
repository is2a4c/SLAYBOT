const { trackVoiceStats } = require("@handlers/stats");
const { tempVoiceHandler, voiceRoleHandler } = require("@src/handlers");
const { getSettings } = require("@schemas/Guild");
const { routeEvent } = require("@src/services/eventRouter/EventRouter");

const musicIdleTimers = new Map();

/**
 * @param {import('@src/structures').BotClient} client
 * @param {import('discord.js').VoiceState} oldState
 * @param {import('discord.js').VoiceState} newState
 */
async function routeVoiceEvent(client, oldState, newState) {
  const member = newState.member || oldState.member;
  if (!member || member.user.bot) return;

  const guild = newState.guild || oldState.guild;
  const logger = client.logger;

  if (!oldState.channelId && newState.channelId) {
    await routeEvent(guild, "VOICE_JOIN", {
      actor: member,
      detail: newState.channel?.name,
      channelId: newState.channelId,
      logger,
    });
  } else if (oldState.channelId && !newState.channelId) {
    await routeEvent(guild, "VOICE_LEAVE", {
      actor: member,
      detail: oldState.channel?.name,
      channelId: oldState.channelId,
      logger,
    });
  } else if (oldState.channelId !== newState.channelId) {
    await routeEvent(guild, "VOICE_MOVE", {
      actor: member,
      detail: `${oldState.channel?.name || "?"} → ${newState.channel?.name || "?"}`,
      channelId: newState.channelId,
      logger,
    });
  }
}

/**
 * @param {import('@src/structures').BotClient} client
 * @param {import('discord.js').VoiceState} oldState
 * @param {import('discord.js').VoiceState} newState
 */
module.exports = async (client, oldState, newState) => {
  client.telemetry?.recordVoiceState(oldState, newState);

  // Voice roles and temporary channels - only when the channel actually changed
  if (oldState.channelId !== newState.channelId) {
    const guild = newState.guild || oldState.guild;

    await routeVoiceEvent(client, oldState, newState).catch((ex) => client.logger.error("eventRouter: voice", ex));

    getSettings(guild)
      .then(async (settings) => {
        await trackVoiceStats(oldState, newState, settings).catch((ex) => client.logger.error("trackVoiceStats", ex));
        await voiceRoleHandler
          .handleVoiceStateUpdate(oldState, newState, settings)
          .catch((ex) => client.logger.error("voiceRoles", ex));

        // Leaving first: a member hopping out of their own channel into the hub
        // should not have the old one linger behind them.
        if (oldState.channelId) {
          await tempVoiceHandler.handleChannelLeave(oldState).catch((ex) => client.logger.error("tempVoice", ex));
        }
        if (newState.channelId) {
          await tempVoiceHandler.handleHubJoin(newState, settings).catch((ex) => client.logger.error("tempVoice", ex));
        }
      })
      .catch((ex) => client.logger.error("voiceStateUpdate", ex));
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
module.exports.routeVoiceEvent = routeVoiceEvent;
