const { ChannelType } = require("discord.js");
const { MAX_FEEDS_PER_GUILD, countFeeds, createFeed, listFeeds, model } = require("@schemas/Feed");
const { FeedError, fetchLatest, normalizeTarget } = require("@src/services/feeds/providers");
const { decideAnnouncement } = require("@src/services/feeds/FeedWatcher");
const { defineCollectionPanel } = require("../collectionPanel");
const { HOME_ID } = require("../ids");

/**
 * Twitch streams, YouTube uploads, RSS items and GitHub releases, as a panel.
 *
 * Adding one reaches out to the source before storing anything: a typo in a
 * channel name is worth finding here rather than in a watcher log nobody reads.
 */

const TYPES = ["TWITCH", "YOUTUBE", "RSS", "GITHUB"];
const TYPE_ICONS = { TWITCH: "🟣", YOUTUBE: "🔴", RSS: "📰", GITHUB: "🐙" };
const TEXT_CHANNELS = [ChannelType.GuildText, ChannelType.GuildAnnouncement];
const SEND = ["ViewChannel", "SendMessages", "EmbedLinks"];

const fields = [
  {
    id: "type",
    nameKey: "panels.feeds.fields.type",
    emoji: "🧩",
    type: "choice",
    required: true,
    choices: TYPES,
    choiceLabels: Object.fromEntries(TYPES.map((type) => [type, type.toLowerCase()])),
  },
  {
    id: "target",
    nameKey: "panels.feeds.fields.target",
    emoji: "🎯",
    type: "text",
    required: true,
    maxLength: 200,
    descriptionKey: "panels.feeds.targetHint",
  },
  {
    id: "channel",
    nameKey: "panels.feeds.fields.channel",
    emoji: "📢",
    type: "channel",
    required: true,
    channelTypes: TEXT_CHANNELS,
  },
  { id: "mention", nameKey: "panels.feeds.fields.mention", emoji: "🔔", type: "role" },
  {
    id: "message",
    nameKey: "panels.feeds.fields.message",
    emoji: "💬",
    type: "text",
    long: true,
    maxLength: 1000,
  },
  { id: "enabled", nameKey: "panels.feeds.fields.enabled", emoji: "🔘", type: "toggle", default: true },
];

/**
 * A mention is stored ready to send, and edited as a role.
 *
 * @param {string|null} mention
 */
function roleOf(mention) {
  const match = /^<@&(\d{17,20})>$/.exec(String(mention || ""));
  return match ? match[1] : null;
}

/**
 * Everything the source and the channel have to satisfy before a feed is stored.
 *
 * @param {import('discord.js').Guild} guild
 * @param {object} values
 * @param {(key: string, vars?: object) => string} t
 * @returns {Promise<{ok: boolean, message?: string, target?: string, lastItemId?: string|null}>}
 */
async function check(guild, values, t) {
  const channel = guild.channels.cache.get(values.channel);
  if (!channel?.isTextBased?.()) return { ok: false, message: t("panels.feeds.badChannel") };
  if (!channel.permissionsFor(guild.members.me)?.has(SEND)) {
    return { ok: false, message: t("panels.feeds.noPermission", { channel: channel.toString() }) };
  }

  let target;
  try {
    target = normalizeTarget(values.type, values.target);
    const latest = await fetchLatest(values.type, target);
    // Adopt what is published now, so setup does not announce a backlog.
    const { store } = decideAnnouncement({ lastItemId: null, item: latest, firstRun: true });
    return { ok: true, target, lastItemId: store };
  } catch (error) {
    if (error instanceof FeedError) return { ok: false, message: error.message };
    throw error;
  }
}

module.exports = defineCollectionPanel({
  id: "CFG_FEEDS",
  icon: "📡",
  titleKey: "panels.feeds.title",
  descriptionKey: "panels.feeds.description",
  emptyKey: "panels.feeds.empty",
  hintKey: "panels.feeds.hint",
  max: MAX_FEEDS_PER_GUILD,
  homeId: HOME_ID,
  fields,

  list: (guild) => listFeeds(guild.id),
  keyOf: (feed) => String(feed._id),
  summarise: (feed) => `${feed.type.toLowerCase()} · ${feed.target}`,

  describe: (feed, t) =>
    [
      `${TYPE_ICONS[feed.type] || "📡"} **${feed.type.toLowerCase()}** \`${feed.target}\` → <#${feed.channel_id}>` +
        ` · ${feed.enabled ? `🟢 ${t("common.on")}` : `⚪ ${t("common.off")}`}` +
        `${feed.mention ? ` · ${feed.mention}` : ""}`,
      feed.last_error ? `-# ${t("panels.feeds.lastError", { error: feed.last_error })}` : "",
    ]
      .filter(Boolean)
      .join("\n"),

  toValues: (feed) => ({
    type: feed.type,
    target: feed.target,
    channel: feed.channel_id,
    mention: roleOf(feed.mention),
    message: feed.message,
    enabled: feed.enabled,
  }),

  async create({ guild, values, user, t }) {
    if ((await countFeeds(guild.id)) >= MAX_FEEDS_PER_GUILD) {
      return { ok: false, message: t("panels.feeds.limit", { max: MAX_FEEDS_PER_GUILD }) };
    }

    const checked = await check(guild, values, t);
    if (!checked.ok) return checked;

    const duplicate = await model.findOne({
      guild_id: guild.id,
      type: values.type,
      target: checked.target,
      channel_id: values.channel,
    });
    if (duplicate) return { ok: false, message: t("panels.feeds.exists", { target: checked.target }) };

    await createFeed({
      guild_id: guild.id,
      type: values.type,
      target: checked.target,
      channel_id: values.channel,
      mention: values.mention ? `<@&${values.mention}>` : null,
      message: values.message || null,
      enabled: values.enabled !== false,
      last_item_id: checked.lastItemId,
      last_checked_at: new Date(),
      created_by: user.id,
    });

    return { ok: true, message: t("panels.feeds.added", { target: checked.target }) };
  },

  async update({ guild, key, values, t }) {
    const feed = await model.findById(key);
    if (!feed) return { ok: false, message: t("collections.gone") };

    const moved = feed.type !== values.type || feed.target !== values.target || feed.channel_id !== values.channel;
    const checked = await check(guild, values, t);
    if (!checked.ok) return checked;

    feed.type = values.type;
    feed.target = checked.target;
    feed.channel_id = values.channel;
    feed.mention = values.mention ? `<@&${values.mention}>` : null;
    feed.message = values.message || null;
    feed.enabled = values.enabled !== false;

    // Pointed somewhere new, it starts from what is published there now rather
    // than announcing that source's whole history.
    if (moved) {
      feed.last_item_id = checked.lastItemId;
      feed.last_error = null;
      feed.consecutive_failures = 0;
    }

    await feed.save();
    return { ok: true, message: t("panels.feeds.saved", { target: feed.target }) };
  },

  async remove({ guild, key, t }) {
    const result = await model.deleteOne({ _id: key, guild_id: guild.id });
    if (!result.deletedCount) return { ok: false, message: t("collections.gone") };

    return { ok: true, message: t("panels.feeds.removed") };
  },
});
