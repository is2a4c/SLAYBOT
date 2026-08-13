const { getMemberStats } = require("@schemas/MemberStats");
const { getRandomInt } = require("@helpers/Utils");
const { EcosystemService } = require("@src/services/ecosystem/EcosystemService");
const { applyRoleRewards } = require("@src/services/stats/RoleRewards");

const cooldownCache = new Map();
const voiceStates = new Map();
const ecosystem = new EcosystemService();

/**
 * @param {string} guildId
 * @param {string} memberId
 */
const getVoiceStateKey = (guildId, memberId) => `${guildId}|${memberId}`;

const xpToAdd = (config = {}) => {
  const min = Math.min(1000, Math.max(0, Number(config.min_per_message ?? 1)));
  const max = Math.min(1000, Math.max(min, Number(config.max_per_message ?? 19)));
  return getRandomInt(max - min + 1) + min;
};

/**
 * @param {string} content
 * @param {import('discord.js').GuildMember} member
 * @param {number} level
 */
const parse = (content, member, level) => {
  return content
    .replaceAll(/\\n/g, "\n")
    .replaceAll(/{server}/g, member.guild.name)
    .replaceAll(/{count}/g, member.guild.memberCount)
    .replaceAll(/{member:id}/g, member.id)
    .replaceAll(/{member:name}/g, member.displayName)
    .replaceAll(/{member:mention}/g, member.toString())
    .replaceAll(/{member:tag}/g, member.user.globalName || member.user.username)
    .replaceAll(/{level}/g, level);
};

module.exports = {
  /**
   * This function saves stats for a new message
   * @param {import("discord.js").Message} message
   * @param {boolean} isCommand
   * @param {object} settings
   * @param {{ skipXp?: boolean, ecosystemService?: EcosystemService }} [options]
   */
  async trackMessageStats(message, isCommand, settings, options = {}) {
    const { skipXp = false, ecosystemService = ecosystem } = options;
    const statsDb = await getMemberStats(message.guildId, message.member.id);
    if (isCommand) statsDb.commands.prefix++;
    statsDb.messages++;

    if (skipXp) {
      await statsDb.save();
      return;
    }

    // Cooldown check to prevent Message Spamming
    const key = `${message.guildId}|${message.member.id}`;
    if (cooldownCache.has(key)) {
      const difference = (Date.now() - cooldownCache.get(key)) * 0.001;
      const cooldown = settings?.stats?.xp?.cooldown_seconds ?? message.client.config.STATS.XP_COOLDOWN;
      if (difference < cooldown) {
        await statsDb.save();
        return;
      }
      cooldownCache.delete(key);
    }

    // Update member's XP in DB
    const earnedXp = xpToAdd(settings?.stats?.xp);
    statsDb.xp += earnedXp;

    // Check if member has levelled up
    let { xp, level } = statsDb;
    const previousLevel = level;
    const multiplier = Math.min(10000, Math.max(10, Number(settings?.stats?.xp?.level_multiplier) || 100));
    let needed = level * level * multiplier;

    while (xp >= needed) {
      level += 1;
      xp -= needed;
      needed = level * level * multiplier;
    }

    if (level !== statsDb.level) {
      statsDb.xp = xp;
      statsDb.level = level;
      let lvlUpMessage = settings?.stats?.xp?.message || message.client.config.STATS.DEFAULT_LVL_UP_MSG;
      lvlUpMessage = parse(lvlUpMessage, message.member, level);

      const xpChannel = settings?.stats?.xp?.channel && message.guild.channels.cache.get(settings.stats.xp.channel);
      const lvlUpChannel = xpChannel || message.channel;

      lvlUpChannel.safeSend(lvlUpMessage);
    }
    await statsDb.save();
    if (level !== previousLevel) {
      await applyRoleRewards(message.member, settings?.stats?.rewards?.level, previousLevel, level).catch((error) => {
        message.client.logger.warn(`Could not apply level rewards for ${message.member.id}: ${error.message}`);
      });
    }
    cooldownCache.set(key, Date.now());
    await ecosystemService
      .recordActivity({
        eventId: message.id,
        guildId: message.guildId,
        userId: message.member.id,
        xp: earnedXp,
        occurredAt: message.createdAt,
      })
      .catch((error) => {
        message.client.logger.warn(`Ecosystem activity was not recorded for message ${message.id}: ${error.message}`);
      });
  },

  /**
   * @param {import('discord.js').Interaction} interaction
   */
  async trackInteractionStats(interaction) {
    if (!interaction.guild) return;
    const statsDb = await getMemberStats(interaction.guildId, interaction.member.id);
    if (interaction.isChatInputCommand()) statsDb.commands.slash += 1;
    if (interaction.isUserContextMenuCommand()) statsDb.contexts.user += 1;
    if (interaction.isMessageContextMenuCommand()) statsDb.contexts.message += 1;
    await statsDb.save();
  },

  /**
   * @param {import('discord.js').VoiceState} oldState
   * @param {import('discord.js').VoiceState} newState
   */
  async trackVoiceStats(oldState, newState, settings) {
    const oldChannel = oldState.channel;
    const newChannel = newState.channel;
    const now = Date.now();

    if (!oldChannel && !newChannel) return;
    if (!newState.member) return;

    const member = await newState.member.fetch().catch(() => {});
    if (!member || member.user.bot) return;

    // Member joined a voice channel
    if (!oldChannel && newChannel) {
      const statsDb = await getMemberStats(member.guild.id, member.id);
      statsDb.voice.connections += 1;
      await statsDb.save();
      const key = getVoiceStateKey(member.guild.id, member.id);
      voiceStates.set(key, now);
    }

    // Member left a voice channel
    if (oldChannel && !newChannel) {
      const statsDb = await getMemberStats(member.guild.id, member.id);
      const key = getVoiceStateKey(member.guild.id, member.id);
      if (voiceStates.has(key)) {
        const previousTime = statsDb.voice.time;
        const time = now - voiceStates.get(key);
        statsDb.voice.time += time / 1000; // add time in seconds
        await statsDb.save();
        await applyRoleRewards(member, settings?.stats?.rewards?.voice, previousTime, statsDb.voice.time).catch(
          (error) => {
            member.client.logger.warn(`Could not apply voice rewards for ${member.id}: ${error.message}`);
          }
        );
        voiceStates.delete(key);
      }
    }
  },
};
