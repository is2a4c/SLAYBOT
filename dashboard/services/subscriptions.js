const { FEED_TYPES, MAX_FEEDS_PER_GUILD, countFeeds, createFeed, listFeeds, model } = require("@schemas/Feed");
const { FeedError, fetchLatest, normalizeTarget } = require("@src/services/feeds/providers");
const { decideAnnouncement } = require("@src/services/feeds/FeedWatcher");

// The schema is the source of truth for what a provider can be; this only
// ever mirrors it, so a new provider never has to be listed twice.
const SUPPORTED_TYPES = FEED_TYPES;
const SEND_PERMISSIONS = ["ViewChannel", "SendMessages", "EmbedLinks"];

class SubscriptionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "SubscriptionError";
    this.code = code;
  }
}

function assertTextChannel(guild, channelId) {
  const channel = guild.channels.cache.get(String(channelId || ""));
  if (!channel?.isTextBased?.() || channel.isThread?.()) {
    throw new SubscriptionError("CHANNEL", "Choose a server text channel.");
  }
  if (!channel.permissionsFor(guild.members.me)?.has(SEND_PERMISSIONS)) {
    throw new SubscriptionError("PERMISSION", "The bot cannot send embeds to that channel.");
  }
  return channel;
}

function roleMention(guild, roleId) {
  if (!roleId) return null;
  const role = guild.roles.cache.get(String(roleId));
  if (!role || role.id === guild.id || role.managed) {
    throw new SubscriptionError("ROLE", "Choose a role the server can mention.");
  }
  return `<@&${role.id}>`;
}

async function createSubscription(guild, input, actorId, dependencies = {}) {
  const type = String(input.type || "").toUpperCase();
  if (!SUPPORTED_TYPES.includes(type)) throw new SubscriptionError("TYPE", "Choose a supported provider.");
  assertTextChannel(guild, input.channelId);

  let target;
  let latest;
  try {
    target = normalizeTarget(type, input.target);
    latest = await (dependencies.fetchLatest || fetchLatest)(type, target);
  } catch (error) {
    if (error instanceof FeedError) throw new SubscriptionError("TARGET", error.message);
    throw error;
  }

  if ((await (dependencies.countFeeds || countFeeds)(guild.id)) >= MAX_FEEDS_PER_GUILD) {
    throw new SubscriptionError("LIMIT", `A server can have at most ${MAX_FEEDS_PER_GUILD} subscriptions.`);
  }

  const channelId = String(input.channelId);
  const duplicate = await (dependencies.model || model).findOne({
    guild_id: guild.id,
    type,
    target,
    channel_id: channelId,
  });
  if (duplicate) throw new SubscriptionError("DUPLICATE", "That subscription already exists in this channel.");

  const { store } = decideAnnouncement({ lastItemId: null, item: latest, firstRun: true });
  return (dependencies.createFeed || createFeed)({
    guild_id: guild.id,
    type,
    target,
    channel_id: channelId,
    mention: roleMention(guild, input.roleId),
    message:
      String(input.message || "")
        .trim()
        .slice(0, 1000) || null,
    enabled: true,
    last_item_id: store,
    last_checked_at: new Date(),
    created_by: actorId,
  });
}

async function setSubscriptionEnabled(guildId, id, enabled, feedModel = model) {
  const feed = await feedModel.findOne({ _id: id, guild_id: guildId });
  if (!feed) throw new SubscriptionError("NOT_FOUND", "Subscription no longer exists.");
  feed.enabled = Boolean(enabled);
  if (feed.enabled) {
    feed.consecutive_failures = 0;
    feed.last_error = null;
  }
  await feed.save();
  return feed;
}

async function deleteSubscription(guildId, id, feedModel = model) {
  const result = await feedModel.deleteOne({ _id: id, guild_id: guildId });
  if (!result.deletedCount) throw new SubscriptionError("NOT_FOUND", "Subscription no longer exists.");
}

module.exports = {
  SUPPORTED_TYPES,
  SubscriptionError,
  createSubscription,
  deleteSubscription,
  listSubscriptions: listFeeds,
  setSubscriptionEnabled,
};
