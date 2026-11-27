const { ChannelType } = require("discord.js");
const ModUtils = require("@helpers/ModUtils");

/**
 * Channel types whose history can be read and purged. Voice and stage channels
 * carry a text chat too, which is exactly what moderating them means.
 */
const MESSAGE_CHANNEL_TYPES = Object.freeze([
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.GuildVoice,
  ChannelType.GuildStageVoice,
  ChannelType.PublicThread,
  ChannelType.PrivateThread,
  ChannelType.AnnouncementThread,
]);

/** The purge methods offered by the interactive command. */
const PURGE_METHODS = Object.freeze([
  { id: "all", purgeType: "ALL", emoji: "🧹" },
  { id: "user", purgeType: "USER", emoji: "👤", needsUser: true },
  { id: "bots", purgeType: "BOT", emoji: "🤖" },
  { id: "links", purgeType: "LINK", emoji: "🔗" },
  { id: "media", purgeType: "MEDIA", emoji: "🖼️" },
  { id: "contains", purgeType: "TOKEN", emoji: "🔍", needsText: true },
]);

const MAX_PER_CHANNEL = 100;
const MAX_CHANNELS = 25;

/**
 * @param {string} methodId
 * @returns {object|undefined}
 */
function getMethod(methodId) {
  return PURGE_METHODS.find((method) => method.id === methodId);
}

/**
 * @param {number} type
 */
function isMessageChannelType(type) {
  return MESSAGE_CHANNEL_TYPES.includes(type);
}

/**
 * Delete messages from every selected channel with one method.
 *
 * Channels are handled one after another on purpose: a bulk delete per channel
 * is cheap, while firing twenty-five of them at once is how a bot meets a rate
 * limit halfway through and leaves the moderator without an honest report. A
 * channel that fails - missing permission, a deleted channel, an unexpected
 * API error - never stops the others; it is reported in its own entry.
 *
 * @param {object} options
 * @param {import('discord.js').GuildMember} options.issuer
 * @param {Array<{id: string, name: string, type: number}>} options.channels
 * @param {string} options.methodId
 * @param {number|string} options.amount per channel
 * @param {string} [options.argument] user id or token, depending on the method
 * @param {Function} [options.purge] the purge implementation, injectable for tests
 * @returns {Promise<{method: object, amount: number, results: Array, deleted: number}|{error: string, results: Array}>}
 */
async function runChannelPurge({ issuer, channels, methodId, amount, argument, purge = ModUtils.purgeMessages }) {
  const method = getMethod(methodId);
  if (!method) return { error: "INVALID_METHOD", results: [] };

  const requested = Number.parseInt(amount, 10);
  if (!Number.isInteger(requested) || requested < 1) return { error: "INVALID_AMOUNT", results: [] };

  const perChannel = Math.min(requested, MAX_PER_CHANNEL);
  const results = [];
  let deleted = 0;

  for (const channel of channels.slice(0, MAX_CHANNELS)) {
    if (!channel || !isMessageChannelType(channel.type)) {
      results.push({ channelId: channel?.id || null, name: channel?.name || "", status: "SKIPPED", deleted: 0 });
      continue;
    }

    let outcome;
    try {
      outcome = await purge(issuer, channel, method.purgeType, perChannel, argument);
    } catch (ex) {
      outcome = "ERROR";
    }

    if (typeof outcome === "number") {
      deleted += outcome;
      results.push({ channelId: channel.id, name: channel.name, status: "OK", deleted: outcome });
    } else {
      results.push({
        channelId: channel.id,
        name: channel.name,
        status: typeof outcome === "string" ? outcome : "ERROR",
        deleted: 0,
      });
    }
  }

  return { method, amount: perChannel, results, deleted };
}

module.exports = {
  MAX_CHANNELS,
  MAX_PER_CHANNEL,
  MESSAGE_CHANNEL_TYPES,
  PURGE_METHODS,
  getMethod,
  isMessageChannelType,
  runChannelPurge,
};
