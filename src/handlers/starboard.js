const { EmbedBuilder, PermissionFlagsBits, parseEmoji } = require("discord.js");
const { EMBED_COLORS } = require("@root/config");
const { blockEntry, deleteEntry, getEntry, getEntryByMirror, upsertEntry } = require("@schemas/StarboardEntry");

const MIRROR_PERMISSIONS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.EmbedLinks,
];

/**
 * Compare a reaction against the configured starboard emoji. Custom emoji are
 * stored by id, unicode emoji by their character.
 * @param {import('discord.js').Emoji} emoji
 * @param {string} configured
 */
function matchesEmoji(emoji, configured) {
  if (!configured) return false;
  const parsed = parseEmoji(configured);
  return parsed?.id ? emoji.id === parsed.id : emoji.name === (parsed?.name || configured);
}

/**
 * Decide what should happen to a starboard entry for a given star count.
 *
 * Pure so the threshold rules can be tested without Discord: the caller only has
 * to carry out the returned action.
 *
 * @param {{count: number, threshold: number, hasMirror: boolean, blocked?: boolean, removeBelow?: boolean}} input
 * @returns {"create"|"update"|"delete"|"none"}
 */
function resolveMirrorAction({ count, threshold, hasMirror, blocked = false, removeBelow = true }) {
  if (blocked) return "none";

  if (count >= threshold) return hasMirror ? "update" : "create";
  if (hasMirror) return removeBelow ? "delete" : "update";
  return "none";
}

/**
 * @param {import('discord.js').Message} message
 * @param {number} count
 * @param {object} config
 */
function buildStarboardMessage(message, count, config) {
  const embed = new EmbedBuilder().setColor(config.color || EMBED_COLORS.BOT_EMBED);

  if (config.show_author !== false) {
    embed.setAuthor({
      name: message.author.globalName || message.author.username,
      iconURL: message.author.displayAvatarURL(),
    });
  }
  if (config.show_timestamp !== false) embed.setTimestamp(message.createdAt);

  const description = [];
  const contentLength = Math.min(3800, Math.max(100, Number(config.content_length) || 3800));
  if (message.content) description.push(message.content.slice(0, contentLength));
  if (config.show_jump_link !== false) description.push(`[Jump to message](${message.url})`);
  if (description.length) embed.setDescription(description.join("\n\n"));

  const image = message.attachments.find((attachment) => attachment.contentType?.startsWith("image/"));
  const displayedImage = image && config.show_images !== false ? image : null;
  if (displayedImage) embed.setImage(displayedImage.url);

  const attachmentList = message.attachments.filter((attachment) => attachment.id !== displayedImage?.id);
  if (attachmentList.size > 0 && config.show_attachments !== false) {
    embed.addFields({
      name: "Attachments",
      value: attachmentList
        .map((attachment) => `[${attachment.name}](${attachment.url})`)
        .join("\n")
        .slice(0, 1024),
    });
  }

  return {
    content:
      config.show_source === false
        ? `${config.emoji} **${count}**`
        : `${config.emoji} **${count}** · <#${message.channelId}>`,
    embeds: [embed],
  };
}

/**
 * @param {import('discord.js').MessageReaction} reaction
 * @param {object} settings
 */
async function syncStarboard(reaction, settings) {
  const config = settings?.starboard;
  if (!config?.enabled || !config.channel_id) return;
  if (!matchesEmoji(reaction.emoji, config.emoji)) return;

  const message = reaction.message;
  if (!message.guild) return;
  if (config.ignored_channels?.includes(message.channelId)) return;
  if (message.author?.bot && !config.allow_bots) return;

  const starboardChannel = message.guild.channels.cache.get(config.channel_id);
  if (!starboardChannel?.isTextBased()) return;
  if (!starboardChannel.permissionsFor(message.guild.members.me)?.has(MIRROR_PERMISSIONS)) return;

  // A starred message inside the starboard itself would mirror forever.
  if (message.channelId === config.channel_id) return;

  const count = await countStars(reaction, config);
  const entry = await getEntry(message.guild.id, message.id);
  const mirrorId = entry?.starboard_message_id || null;

  const action = resolveMirrorAction({
    count,
    threshold: config.threshold || 3,
    hasMirror: Boolean(mirrorId),
    blocked: Boolean(entry?.blocked),
    removeBelow: config.remove_below !== false,
  });

  if (action === "none") return;

  if (action === "delete") {
    await starboardChannel.messages
      .fetch(mirrorId)
      .then((mirror) => mirror.delete())
      .catch(() => {});
    await deleteEntry(message.guild.id, message.id);
    return;
  }

  const payload = buildStarboardMessage(message, count, config);

  if (action === "update") {
    const mirror = await starboardChannel.messages.fetch(mirrorId).catch(() => null);
    if (mirror) {
      await mirror.edit(payload).catch(() => {});
      entry.count = count;
      await entry.save();
      return;
    }
    // The mirror is gone (deleted by staff): fall through and post a fresh one.
  }

  const mirror = await starboardChannel.send(payload).catch(() => null);
  if (!mirror) return;

  await upsertEntry({
    guildId: message.guild.id,
    channelId: message.channelId,
    messageId: message.id,
    starboardChannelId: starboardChannel.id,
    starboardMessageId: mirror.id,
    authorId: message.author?.id || null,
    count,
  });
}

/**
 * Star count for a message, minus the author's own star when self-starring is off.
 * @param {import('discord.js').MessageReaction} reaction
 * @param {object} config
 */
async function countStars(reaction, config) {
  if (config.self_star !== false) return reaction.count || 0;

  const users = await reaction.users.fetch().catch(() => null);
  if (!users) return reaction.count || 0;

  return users.filter((user) => !user.bot && user.id !== reaction.message.author?.id).size;
}

module.exports = {
  buildStarboardMessage,
  matchesEmoji,
  resolveMirrorAction,
  syncStarboard,

  /**
   * Keep the database honest when a starred message or its mirror is deleted.
   * @param {import('discord.js').Message|import('discord.js').PartialMessage} message
   */
  async handleMessageDelete(message) {
    if (!message.guild) return;

    const entry = await getEntry(message.guild.id, message.id).catch(() => null);
    if (entry) {
      if (entry.starboard_message_id) {
        const channel = message.guild.channels.cache.get(entry.starboard_channel_id);
        await channel?.messages
          ?.fetch(entry.starboard_message_id)
          .then((mirror) => mirror.delete())
          .catch(() => {});
      }
      await deleteEntry(message.guild.id, message.id);
      return;
    }

    // Staff deleted the mirror: remember that so stars do not resurrect it.
    const mirrored = await getEntryByMirror(message.guild.id, message.id).catch(() => null);
    if (mirrored) await blockEntry(message.guild.id, mirrored.message_id);
  },
};
