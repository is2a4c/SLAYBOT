const { EmbedBuilder } = require("discord.js");
const { EMBED_COLORS } = require("@root/config");
const { listEnabledFeeds } = require("@schemas/Feed");
const { FeedError, fetchLatest } = require("./providers");

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const MAX_FAILURES_BEFORE_PAUSE = 10;
const CONCURRENCY = 4;

const TYPE_STYLE = {
  TWITCH: { color: "#9146FF", label: "Twitch", verb: "is live" },
  YOUTUBE: { color: "#FF0000", label: "YouTube", verb: "posted a video" },
  RSS: { color: "#FF9900", label: "RSS", verb: "published" },
  GITHUB: { color: "#24292F", label: "GitHub", verb: "shipped" },
};

/**
 * Is this item worth announcing?
 *
 * Pure so the "never spam on restart" rule is testable: the very first check of
 * a feed only records the current item, and an unchanged item stays quiet.
 *
 * @param {{lastItemId: string|null, item: object|null, firstRun?: boolean}} input
 * @returns {{announce: boolean, store: string|null}}
 */
function decideAnnouncement({ lastItemId, item, firstRun = false }) {
  if (!item) return { announce: false, store: lastItemId };
  if (item.id === lastItemId) return { announce: false, store: lastItemId };

  // A brand new feed adopts the current item silently, so adding a feed does not
  // dump the latest video or an old stream into the channel.
  if (firstRun || !lastItemId) return { announce: false, store: item.id };

  return { announce: true, store: item.id };
}

/**
 * @param {object} feed
 * @param {object} item
 */
function buildAnnouncement(feed, item) {
  const style = TYPE_STYLE[feed.type] || { color: EMBED_COLORS.BOT_EMBED, label: feed.type, verb: "posted" };
  const author = item.extra?.author || feed.target;

  const embed = new EmbedBuilder()
    .setColor(style.color)
    .setAuthor({ name: `${style.label} · ${author}` })
    .setTitle(item.title.slice(0, 250))
    .setURL(item.link || null)
    .setTimestamp(item.publishedAt || new Date());

  const details = [];
  if (item.extra?.game) details.push(`**Playing:** ${item.extra.game}`);
  if (typeof item.extra?.viewers === "number") details.push(`**Viewers:** ${item.extra.viewers}`);
  if (item.extra?.kind) details.push(`**Type:** ${item.extra.kind}`);
  if (item.extra?.source) details.push(`**Source:** ${item.extra.source}`);
  if (item.extra?.body) details.push(item.extra.body);
  if (details.length) embed.setDescription(details.join("\n").slice(0, 2000));

  if (item.extra?.thumbnail) embed.setImage(item.extra.thumbnail);

  const content = [feed.mention, feed.message || `${author} ${style.verb}: ${item.link || ""}`.trim()]
    .filter(Boolean)
    .join(" ")
    .slice(0, 2000);

  return { content, embeds: [embed] };
}

/**
 * Polls every configured feed and announces new items.
 *
 * One watcher for four providers: the difference between Twitch, YouTube, RSS and
 * GitHub is a single fetch function, and everything else (deduplication, failure
 * backoff, permission checks) is shared.
 */
class FeedWatcher {
  /**
   * @param {{client: object, intervalMs?: number}} options
   */
  constructor({ client, intervalMs = DEFAULT_INTERVAL_MS } = {}) {
    this.client = client;
    this.intervalMs = intervalMs;
    this.timer = null;
    this.running = false;
  }

  /**
   * @param {object} feed feed document
   */
  async checkFeed(feed) {
    const guild = this.client.guilds.cache.get(feed.guild_id);
    if (!guild) return { skipped: true };

    let item = null;
    try {
      item = await fetchLatest(feed.type, feed.target);
      feed.last_error = null;
      feed.consecutive_failures = 0;
    } catch (error) {
      feed.consecutive_failures += 1;
      feed.last_error = String(error?.message || error).slice(0, 300);

      // A feed that keeps failing is paused rather than hammered forever.
      if (feed.consecutive_failures >= MAX_FAILURES_BEFORE_PAUSE) {
        feed.enabled = false;
        this.client.logger?.warn(
          `Feed paused after repeated failures: ${feed.type} ${feed.target} (${feed.last_error})`
        );
      }

      feed.last_checked_at = new Date();
      await feed.save().catch(() => {});
      return { failed: true, error: error instanceof FeedError ? error.message : "unexpected error" };
    }

    const { announce, store } = decideAnnouncement({ lastItemId: feed.last_item_id, item });

    feed.last_item_id = store;
    feed.last_checked_at = new Date();
    await feed.save().catch(() => {});

    if (!announce) return { announced: false };

    const channel = guild.channels.cache.get(feed.channel_id);
    if (!channel?.isTextBased()) return { announced: false };
    if (!channel.permissionsFor(guild.members.me)?.has(["ViewChannel", "SendMessages", "EmbedLinks"])) {
      return { announced: false };
    }

    await channel.send(buildAnnouncement(feed, item)).catch((error) => {
      this.client.logger?.error(`Feed announcement failed for ${feed.type} ${feed.target}`, error);
    });

    return { announced: true };
  }

  /**
   * One polling pass over every enabled feed.
   */
  async tick() {
    const feeds = await listEnabledFeeds();
    let announced = 0;
    let failed = 0;

    for (let i = 0; i < feeds.length; i += CONCURRENCY) {
      const batch = feeds.slice(i, i + CONCURRENCY);
      const results = await Promise.all(
        batch.map((feed) =>
          this.checkFeed(feed).catch((error) => {
            this.client.logger?.error("FeedWatcher: unexpected failure", error);
            return { failed: true };
          })
        )
      );

      for (const result of results) {
        if (result?.announced) announced += 1;
        if (result?.failed) failed += 1;
      }
    }

    return { checked: feeds.length, announced, failed };
  }

  start() {
    if (this.timer) return this;

    const run = async () => {
      if (this.running) return;
      this.running = true;
      try {
        await this.tick();
      } catch (error) {
        this.client.logger?.error("FeedWatcher tick failed", error);
      } finally {
        this.running = false;
      }
    };

    this.timer = setInterval(run, this.intervalMs);
    if (typeof this.timer.unref === "function") this.timer.unref();
    run();

    this.client.logger?.success(`Feed watcher started (every ${Math.round(this.intervalMs / 1000)}s)`);
    return this;
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

module.exports = {
  CONCURRENCY,
  DEFAULT_INTERVAL_MS,
  FeedWatcher,
  MAX_FAILURES_BEFORE_PAUSE,
  TYPE_STYLE,
  buildAnnouncement,
  decideAnnouncement,
};
