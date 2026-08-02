const { ChannelType } = require("discord.js");
const { deleteSticky, getSticky, listStickies, saveSticky } = require("@schemas/StickyMessage");
const { defineCollectionPanel } = require("../collectionPanel");
const { HOME_ID } = require("../ids");

/**
 * The message that keeps itself at the bottom of a channel.
 *
 * Saving one posts it straight away, so the panel shows what the channel will
 * show; removing one takes the posted copy with it rather than leaving it behind
 * as an ordinary message nobody can move.
 */

const TEXT_CHANNELS = [ChannelType.GuildText, ChannelType.GuildAnnouncement];
const NEEDED = ["ViewChannel", "SendMessages", "ManageMessages", "ReadMessageHistory"];

const fields = [
  {
    id: "channel",
    nameKey: "panels.sticky.fields.channel",
    emoji: "📢",
    type: "channel",
    required: true,
    channelTypes: TEXT_CHANNELS,
  },
  {
    id: "content",
    nameKey: "panels.sticky.fields.content",
    emoji: "💬",
    type: "text",
    required: true,
    long: true,
    maxLength: 2000,
  },
  { id: "title", nameKey: "panels.sticky.fields.title", emoji: "✏️", type: "text", maxLength: 200 },
  { id: "embed", nameKey: "panels.sticky.fields.embed", emoji: "🖼️", type: "toggle", default: true },
  { id: "minMessages", nameKey: "panels.sticky.fields.minMessages", emoji: "🔢", type: "number", min: 1, max: 50 },
  { id: "cooldown", nameKey: "panels.sticky.fields.cooldown", emoji: "⏱️", type: "number", min: 0, max: 3600 },
  { id: "enabled", nameKey: "panels.sticky.fields.enabled", emoji: "🔘", type: "toggle", default: true },
];

/**
 * Store one, post it, and say what happened.
 *
 * @param {Object} context
 * @param {import('discord.js').Guild} context.guild
 * @param {object} context.settings
 * @param {object} context.values
 * @param {object} context.user
 * @param {(key: string, vars?: object) => string} context.t
 */
async function put({ guild, settings, values, user, t }) {
  const channel = guild.channels.cache.get(values.channel);
  if (!channel?.isTextBased?.()) return { ok: false, message: t("panels.sticky.badChannel") };

  if (!channel.permissionsFor(guild.members.me)?.has(NEEDED)) {
    return { ok: false, message: t("panels.sticky.noPermission", { channel: channel.toString() }) };
  }

  const existing = await getSticky(guild.id, channel.id);
  const sticky = await saveSticky({
    guild_id: guild.id,
    channel_id: channel.id,
    // `\n` typed into a one-line box is what somebody means by a new line.
    content: String(values.content).replaceAll("\\n", "\n").slice(0, 2000),
    embed: values.embed !== false,
    title: values.title || null,
    min_messages: values.minMessages ?? existing?.min_messages ?? 1,
    cooldown_seconds: values.cooldown ?? existing?.cooldown_seconds ?? 5,
    enabled: values.enabled !== false,
    created_by: existing?.created_by || user.id,
    last_message_id: existing?.last_message_id || null,
  });

  const { stickyHandler } = require("@src/handlers");

  if (!sticky.enabled) {
    // Paused: take the posted copy down rather than leaving a message that no
    // longer moves.
    stickyHandler.forget(channel.id);
    return { ok: true, message: t("panels.sticky.paused", { channel: channel.toString() }) };
  }

  try {
    await stickyHandler.postNow(channel, sticky, settings);
  } catch (error) {
    guild.client.logger?.error("sticky panel: failed to post", error);
    return { ok: false, message: t("panels.sticky.notPosted", { channel: channel.toString() }) };
  }

  return { ok: true, message: t("panels.sticky.saved", { channel: channel.toString() }) };
}

module.exports = defineCollectionPanel({
  id: "CFG_STICKY",
  icon: "📌",
  titleKey: "panels.sticky.title",
  descriptionKey: "panels.sticky.description",
  emptyKey: "panels.sticky.empty",
  hintKey: "panels.sticky.hint",
  homeId: HOME_ID,
  fields,

  list: (guild) => listStickies(guild.id),
  keyOf: (sticky) => sticky.channel_id,
  summarise: (sticky, t) => `#${sticky.channel_id} · ${sticky.enabled ? t("common.on") : t("common.off")}`,

  describe: (sticky, t) =>
    [
      `📌 <#${sticky.channel_id}> · ${sticky.enabled ? `🟢 ${t("common.on")}` : `⚪ ${t("common.off")}`}`,
      `-# ${t("panels.sticky.rule", { messages: sticky.min_messages, seconds: sticky.cooldown_seconds })}`,
      `> ${sticky.content.replaceAll("\n", " ").slice(0, 120)}`,
    ].join("\n"),

  toValues: (sticky) => ({
    channel: sticky.channel_id,
    content: sticky.content,
    title: sticky.title,
    embed: sticky.embed,
    minMessages: sticky.min_messages,
    cooldown: sticky.cooldown_seconds,
    enabled: sticky.enabled,
  }),

  create: (context) => put(context),

  async update(context) {
    // Moved to another channel: the old one keeps neither the sticky nor its copy.
    if (context.key !== context.values.channel) {
      await module.exports.remove({ ...context, quiet: true });
    }

    return put(context);
  },

  async remove({ guild, key, t }) {
    const existing = await getSticky(guild.id, key);
    if (!existing) return { ok: false, message: t("collections.gone") };

    if (existing.last_message_id) {
      const channel = guild.channels.cache.get(key);
      await channel?.messages
        ?.fetch(existing.last_message_id)
        .then((message) => message.delete())
        .catch(() => {});
    }

    await deleteSticky(guild.id, key);
    require("@src/handlers").stickyHandler.forget(key);

    return { ok: true, message: t("panels.sticky.removed") };
  },
});
