const { EmbedBuilder } = require("discord.js");
const { EMBED_COLORS } = require("@root/config");
const { listEnabledFeeds } = require("@schemas/Feed");
const { FeedError, fetchLatest } = require("./providers");
const { routeEvent } = require("@src/services/eventRouter/EventRouter");

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const MAX_FAILURES_BEFORE_PAUSE = 10;
const CONCURRENCY = 4;
const MAX_EMBED_DESCRIPTION = 4096;

const TYPE_STYLE = {
  TWITCH: { color: "#9146FF", label: "Twitch", verb: "is live" },
  YOUTUBE: { color: "#FF0000", label: "YouTube", verb: "posted a video" },
  RSS: { color: "#FF9900", label: "RSS", verb: "published" },
  GITHUB: { color: "#24292F", label: "GitHub", verb: "shipped" },
  TROVO: { color: "#1CE7C0", label: "Trovo", verb: "is live" },
  VK: { color: "#0077FF", label: "VK", verb: "posted" },
};

/**
 * Keep an announcement inside Discord's embed limit without ending halfway
 * through a release-note line. Full notes remain one click away on GitHub.
 *
 * @param {string} value
 * @param {string|null|undefined} link
 */
function fitDescription(value, link) {
  const text = String(value || "").trim();
  if (text.length <= MAX_EMBED_DESCRIPTION) return text;

  const suffix = link ? `\n\n… [Read the full release notes on GitHub →](${link})` : "\n\n…";
  // Reserve enough room to close a fenced code block if the chosen boundary is
  // inside one. This keeps the link and the rest of the embed out of the block.
  const budget = MAX_EMBED_DESCRIPTION - suffix.length - 4;
  const preview = text.slice(0, budget).trimEnd();
  const minimumUsefulBoundary = Math.floor(budget * 0.6);
  const boundaries = [preview.lastIndexOf("\n\n"), preview.lastIndexOf("\n"), preview.lastIndexOf(" ")];
  const boundary = boundaries.find((position) => position >= minimumUsefulBoundary);
  const shortened = (boundary === undefined ? preview : preview.slice(0, boundary)).trimEnd();
  const closesCodeBlock = (shortened.match(/```/g) || []).length % 2 === 1 ? "\n```" : "";

  return `${shortened}${closesCodeBlock}${suffix}`;
}

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
 * The variables a publication template may use. Every one of them is a name
 * substituted for a value - there is no expression, no lookup chain and no
 * code, so a server administrator writing a template cannot make the bot do
 * anything beyond arranging plain text.
 *
 * A variable a provider has nothing for (`{game}` on a GitHub release) becomes
 * an empty string rather than being left as literal `{game}` text.
 *
 * @param {string} value
 * @param {{feed: object, item: object, author: string, guildName?: string}} context
 * @returns {string}
 */
function renderAnnouncementText(value, { feed, item, author, guildName }) {
  return String(value || "")
    .replaceAll("{title}", item.title || "")
    .replaceAll("{url}", item.link || "")
    .replaceAll("{author}", author || "")
    .replaceAll("{channel}", feed.target || "")
    .replaceAll("{server}", guildName || "")
    .replaceAll("{mention}", feed.mention || "")
    .replaceAll("{game}", item.extra?.game || "")
    .replaceAll("{viewers}", typeof item.extra?.viewers === "number" ? String(item.extra.viewers) : "");
}

/**
 * @param {object} feed
 * @param {object} item
 * @param {{guildName?: string}} [context]
 */
function buildAnnouncement(feed, item, { guildName } = {}) {
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
  if (details.length) embed.setDescription(fitDescription(details.join("\n"), item.link));

  if (item.extra?.thumbnail) embed.setImage(item.extra.thumbnail);

  const templateContext = { feed, item, author, guildName };
  const text = feed.message
    ? renderAnnouncementText(feed.message, templateContext)
    : `${author} ${style.verb}: ${item.link || ""}`.trim();

  // A template that already placed {mention} itself is not mentioned again -
  // only a template that never mentioned it gets the automatic prepend.
  const mentionPlaced = feed.message && String(feed.message).includes("{mention}");
  const content = [mentionPlaced ? null : feed.mention, text].filter(Boolean).join(" ").slice(0, 2000);

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
      item = await fetchLatest(feed.type, feed.target, {
        keyword: feed.keyword_filter,
        attachmentType: feed.attachment_filter,
      });
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
        await routeEvent(guild, "SUBSCRIPTION_PAUSED", {
          detail: `${feed.type.toLowerCase()} ${feed.target}`,
          reason: feed.last_error,
          logger: this.client.logger,
        });
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

    await channel.send(buildAnnouncement(feed, item, { guildName: guild.name })).catch((error) => {
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
  fitDescription,
  renderAnnouncementText,
};
