const { EmbedBuilder, PermissionFlagsBits } = require("discord.js");
const { EMBED_COLORS } = require("@root/config");
const { getCachedSticky, markPosted } = require("@schemas/StickyMessage");
const { applyBranding, resolveBranding } = require("@helpers/Branding");

const REQUIRED_PERMISSIONS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.ReadMessageHistory,
];

// channelId -> messages seen since the sticky was last posted, and an in-flight guard.
const pending = new Map();

/**
 * Should the sticky be moved to the bottom again?
 *
 * Pure so the "do not spam the channel" rules are testable: a sticky waits for
 * `min_messages` new messages and `cooldown_seconds` before it moves.
 *
 * @param {{sticky: object, messagesSince: number, now?: number}} input
 */
function shouldRepost({ sticky, messagesSince, now = Date.now() }) {
  if (!sticky?.enabled) return false;
  if (messagesSince < (sticky.min_messages || 1)) return false;

  const cooldownMs = (sticky.cooldown_seconds || 0) * 1000;
  if (!cooldownMs || !sticky.last_posted_at) return true;

  return now - new Date(sticky.last_posted_at).getTime() >= cooldownMs;
}

/**
 * @param {object} sticky
 * @param {{settings?: object, client?: import('discord.js').Client}} [context] guild branding
 */
function buildStickyPayload(sticky, { settings, client } = {}) {
  if (!sticky.embed) return { content: sticky.content };

  const embed = new EmbedBuilder().setColor(sticky.color || EMBED_COLORS.BOT_EMBED).setDescription(sticky.content);
  if (sticky.title) embed.setTitle(sticky.title);
  if (!sticky.color) applyBranding(embed, resolveBranding(settings, client), { force: true });
  return { embeds: [embed] };
}

module.exports = {
  buildStickyPayload,
  shouldRepost,

  /**
   * Called for every guild message. Cheap when the channel has no sticky.
   * @param {import('discord.js').Message} message
   * @param {object} [settings] guild settings, used for branding
   */
  async handleMessage(message, settings) {
    const sticky = getCachedSticky(message.channelId);
    if (!sticky || sticky.guild_id !== message.guildId) return;
    // Our own repost must not count towards the next repost.
    if (message.author.id === message.client.user.id && message.id === sticky.last_message_id) return;

    const state = pending.get(message.channelId) || { count: 0, running: false };
    state.count += 1;
    pending.set(message.channelId, state);

    if (state.running) return;
    if (!shouldRepost({ sticky, messagesSince: state.count })) return;

    const channel = message.channel;
    if (!channel.permissionsFor(message.guild.members.me)?.has(REQUIRED_PERMISSIONS)) return;

    state.running = true;
    try {
      if (sticky.last_message_id) {
        await channel.messages
          .fetch(sticky.last_message_id)
          .then((previous) => previous.delete())
          .catch(() => {});
      }

      const posted = await channel.send(buildStickyPayload(sticky, { settings, client: message.client }));
      await markPosted(message.channelId, posted.id);
      pending.set(message.channelId, { count: 0, running: false });
    } catch (ex) {
      message.client.logger?.error("stickyMessages: failed to repost", ex);
      pending.set(message.channelId, { count: state.count, running: false });
    }
  },

  /**
   * Post the sticky right away, e.g. after it was created or edited.
   * @param {import('discord.js').TextBasedChannel} channel
   * @param {object} sticky
   * @param {object} [settings] guild settings, used for branding
   */
  async postNow(channel, sticky, settings) {
    if (sticky.last_message_id) {
      await channel.messages
        .fetch(sticky.last_message_id)
        .then((previous) => previous.delete())
        .catch(() => {});
    }

    const posted = await channel.send(buildStickyPayload(sticky, { settings, client: channel.client }));
    await markPosted(channel.id, posted.id);
    pending.set(channel.id, { count: 0, running: false });
    return posted;
  },

  /**
   * @param {string} channelId
   */
  forget(channelId) {
    pending.delete(channelId);
  },
};
