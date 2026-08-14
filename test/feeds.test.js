const test = require("node:test");
const assert = require("node:assert/strict");
require("module-alias/register");

const { FeedError, normalizeTarget, parseFeed } = require("../src/services/feeds/providers");
const { buildAnnouncement, decideAnnouncement, renderAnnouncementText } = require("../src/services/feeds/FeedWatcher");

/* ------------------------------------------------------------------- targets */

test("twitch targets accept a url or a bare login", () => {
  assert.equal(normalizeTarget("TWITCH", "https://twitch.tv/Ninja"), "ninja");
  assert.equal(normalizeTarget("TWITCH", "Ninja"), "ninja");
  assert.throws(() => normalizeTarget("TWITCH", "a b"), FeedError);
});

test("youtube targets require the channel id", () => {
  assert.equal(
    normalizeTarget("YOUTUBE", "https://youtube.com/channel/UC_x5XG1OV2P6uZZ5FSM9Ttw"),
    "UC_x5XG1OV2P6uZZ5FSM9Ttw"
  );
  assert.throws(() => normalizeTarget("YOUTUBE", "@handle"), /channel id/);
});

test("github targets normalise to owner/repo", () => {
  assert.equal(normalizeTarget("GITHUB", "https://github.com/discordjs/discord.js"), "discordjs/discord.js");
  assert.equal(normalizeTarget("GITHUB", "discordjs/discord.js.git"), "discordjs/discord.js");
  assert.throws(() => normalizeTarget("GITHUB", "discordjs"), /owner\/repo/);
});

test("rss targets must be http urls", () => {
  assert.equal(normalizeTarget("RSS", "https://example.com/feed.xml"), "https://example.com/feed.xml");
  assert.throws(() => normalizeTarget("RSS", "ftp://example.com/feed"), /http and https/);
  assert.throws(() => normalizeTarget("RSS", "not a url"), /valid feed URL/);
  assert.throws(() => normalizeTarget("RSS", ""), /Provide what should be watched/);
});

/* --------------------------------------------------------------------- parser */

test("RSS 2.0 items are parsed with guid, title and link", () => {
  const xml = `<?xml version="1.0"?><rss version="2.0"><channel>
    <title>Blog</title>
    <item>
      <guid>post-2</guid>
      <title><![CDATA[Second &amp; newest]]></title>
      <link>https://example.com/2</link>
      <pubDate>Wed, 29 Jul 2026 10:00:00 GMT</pubDate>
    </item>
    <item><guid>post-1</guid><title>First</title><link>https://example.com/1</link></item>
  </channel></rss>`;

  const { title, items } = parseFeed(xml);

  assert.equal(title, "Blog");
  assert.equal(items.length, 2);
  assert.equal(items[0].id, "post-2");
  assert.equal(items[0].title, "Second & newest");
  assert.equal(items[0].link, "https://example.com/2");
  assert.equal(items[0].publishedAt.toISOString(), "2026-07-29T10:00:00.000Z");
});

test("Atom entries take the link from the href attribute", () => {
  const xml = `<feed xmlns="http://www.w3.org/2005/Atom">
    <title>Channel</title>
    <entry>
      <id>yt:video:abc123</id>
      <title>New video</title>
      <link rel="alternate" href="https://www.youtube.com/watch?v=abc123"/>
      <published>2026-07-30T08:00:00+00:00</published>
      <author><name>Creator</name></author>
    </entry>
  </feed>`;

  const { items } = parseFeed(xml);

  assert.equal(items[0].id, "yt:video:abc123");
  assert.equal(items[0].link, "https://www.youtube.com/watch?v=abc123");
  assert.equal(items[0].author, "Creator");
  assert.equal(items[0].publishedAt.toISOString(), "2026-07-30T08:00:00.000Z");
});

test("an empty or broken document yields no items instead of throwing", () => {
  assert.deepEqual(parseFeed("").items, []);
  assert.deepEqual(parseFeed("<html><body>nope</body></html>").items, []);
});

/* ------------------------------------------------------------- announcements */

test("a brand new feed adopts the current item without announcing it", () => {
  const item = { id: "video-1" };

  assert.deepEqual(decideAnnouncement({ lastItemId: null, item }), { announce: false, store: "video-1" });
  assert.deepEqual(decideAnnouncement({ lastItemId: "video-0", item, firstRun: true }), {
    announce: false,
    store: "video-1",
  });
});

test("only a changed item is announced", () => {
  assert.deepEqual(decideAnnouncement({ lastItemId: "video-1", item: { id: "video-1" } }), {
    announce: false,
    store: "video-1",
  });
  assert.deepEqual(decideAnnouncement({ lastItemId: "video-1", item: { id: "video-2" } }), {
    announce: true,
    store: "video-2",
  });
});

test("nothing published keeps the stored item untouched", () => {
  assert.deepEqual(decideAnnouncement({ lastItemId: "stream-9", item: null }), { announce: false, store: "stream-9" });
});

test("twitch announcements carry the game, viewers and mention", () => {
  const payload = buildAnnouncement(
    { type: "TWITCH", target: "ninja", mention: "<@&123>", message: null },
    {
      id: "42",
      title: "Ranked grind",
      link: "https://twitch.tv/ninja",
      publishedAt: new Date("2026-07-30T12:00:00.000Z"),
      extra: { author: "Ninja", game: "Fortnite", viewers: 1234, thumbnail: "https://cdn/thumb.jpg" },
    }
  );

  assert.match(payload.content, /<@&123>/);
  assert.match(payload.content, /Ninja is live/);
  const embed = payload.embeds[0].data;
  assert.equal(embed.title, "Ranked grind");
  assert.equal(embed.url, "https://twitch.tv/ninja");
  assert.match(embed.description, /Fortnite/);
  assert.match(embed.description, /1234/);
  assert.equal(embed.image.url, "https://cdn/thumb.jpg");
});

test("a custom message replaces the default announcement text", () => {
  const payload = buildAnnouncement(
    { type: "YOUTUBE", target: "UC123", mention: null, message: "New upload, go watch it" },
    { id: "v1", title: "Video", link: "https://youtu.be/v1", publishedAt: null, extra: { author: "Creator" } }
  );

  assert.equal(payload.content, "New upload, go watch it");
  assert.equal(payload.embeds[0].data.author.name, "YouTube · Creator");
});

test("github announcements keep release notes that fit in a Discord embed", () => {
  const body = `## What is new\n\n${"A complete release note. ".repeat(100)}`;
  const payload = buildAnnouncement(
    { type: "GITHUB", target: "is2a4c/SLAYBOT", mention: null, message: null },
    {
      id: "release-1",
      title: "SLAYBOT v3.1.0",
      link: "https://github.com/is2a4c/SLAYBOT/releases/tag/v3.1.0",
      publishedAt: null,
      extra: { author: "is2a4c", kind: "release", body },
    }
  );

  assert.match(payload.embeds[0].data.description, /A complete release note/);
  assert.ok(payload.embeds[0].data.description.endsWith(body.trimEnd()));
  assert.doesNotMatch(payload.embeds[0].data.description, /Read the full release notes/);
});

test("oversized github release notes end cleanly with a link to the full text", () => {
  const body = Array.from({ length: 300 }, (_, index) => `- **Change ${index}:** a useful improvement`).join("\n");
  const link = "https://github.com/is2a4c/SLAYBOT/releases/tag/v4.0.0";
  const payload = buildAnnouncement(
    { type: "GITHUB", target: "is2a4c/SLAYBOT", mention: null, message: null },
    {
      id: "release-2",
      title: "SLAYBOT v4.0.0",
      link,
      publishedAt: null,
      extra: { author: "is2a4c", kind: "release", body },
    }
  );

  const description = payload.embeds[0].data.description;
  const preview = description.split("\n\n…")[0];
  assert.ok(description.length <= 4096);
  assert.match(description, /\n\n… \[Read the full release notes on GitHub →\]\(.+\)$/);
  assert.match(preview.split("\n").at(-1), /^- \*\*Change \d+:\*\* a useful improvement$/);
});

/* ------------------------------------------------------------- templates */

test("a template variable is substituted with the matching value", () => {
  const feed = { target: "ninja", mention: "<@&1>" };
  const item = {
    title: "Ranked grind",
    link: "https://twitch.tv/ninja",
    extra: { author: "Ninja", game: "Fortnite", viewers: 42 },
  };

  const text = renderAnnouncementText("{author} is live on {channel}: {title} ({url}) - {viewers} watching {game}", {
    feed,
    item,
    author: item.extra.author,
    guildName: "My Server",
  });

  assert.equal(text, "Ninja is live on ninja: Ranked grind (https://twitch.tv/ninja) - 42 watching Fortnite");
});

test("a variable a provider has nothing for renders as nothing, not literal text", () => {
  const text = renderAnnouncementText("{title} · {game} · {viewers} · {server}", {
    feed: { target: "repo" },
    item: { title: "Release", extra: {} },
    author: "author",
  });

  assert.equal(text, "Release ·  ·  · ");
});

test("{server} fills in from the guild the feed announces into", () => {
  const text = renderAnnouncementText("posted in {server}", {
    feed: {},
    item: { title: "x", extra: {} },
    author: "a",
    guildName: "Slay HQ",
  });
  assert.equal(text, "posted in Slay HQ");
});

test("a template replaces the default text but keeps the automatic mention", () => {
  const payload = buildAnnouncement(
    { type: "GITHUB", target: "is2a4c/SLAYBOT", mention: "<@&9>", message: "Shipped {title} → {url}" },
    { id: "r1", title: "v2.0", link: "https://x/v2", publishedAt: null, extra: { author: "is2a4c", kind: "release" } }
  );

  assert.equal(payload.content, "<@&9> Shipped v2.0 → https://x/v2");
});

test("a template that places {mention} itself is not mentioned a second time", () => {
  const payload = buildAnnouncement(
    { type: "GITHUB", target: "is2a4c/SLAYBOT", mention: "<@&9>", message: "Hey {mention}, {title} is out" },
    { id: "r1", title: "v2.0", link: "https://x/v2", publishedAt: null, extra: { author: "is2a4c", kind: "release" } }
  );

  assert.equal(payload.content, "Hey <@&9>, v2.0 is out");
});

test("{server} reaches the built announcement through the guild name FeedWatcher passes in", () => {
  const payload = buildAnnouncement(
    { type: "RSS", target: "https://example.com/feed", mention: null, message: "New post in {server}: {title}" },
    { id: "p1", title: "Hello", link: "https://example.com/p1", publishedAt: null, extra: {} },
    { guildName: "Community" }
  );

  assert.equal(payload.content, "New post in Community: Hello");
});
