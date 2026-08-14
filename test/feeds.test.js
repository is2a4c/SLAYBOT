const test = require("node:test");
const assert = require("node:assert/strict");
require("module-alias/register");

const { FEED_TYPES } = require("@schemas/Feed");
const {
  FeedError,
  PROVIDERS,
  extractChannelIdFromHtml,
  matchesVkFilters,
  normalizeTarget,
  parseFeed,
  redactedUrl,
  request,
  youtubeHandlePath,
} = require("../src/services/feeds/providers");
const {
  TYPE_STYLE,
  buildAnnouncement,
  decideAnnouncement,
  renderAnnouncementText,
} = require("../src/services/feeds/FeedWatcher");
const { SUPPORTED_TYPES, vkFilters } = require("../dashboard/services/subscriptions");

/* ------------------------------------------------------------------- targets */
// normalizeTarget is async because YOUTUBE's handle/URL form has to look the
// id up; every other type still resolves without ever awaiting anything.

test("twitch targets accept a url or a bare login", async () => {
  assert.equal(await normalizeTarget("TWITCH", "https://twitch.tv/Ninja"), "ninja");
  assert.equal(await normalizeTarget("TWITCH", "Ninja"), "ninja");
  await assert.rejects(() => normalizeTarget("TWITCH", "a b"), FeedError);
});

test("a youtube channel id is recognised on sight, with no lookup needed", async () => {
  assert.equal(
    await normalizeTarget("YOUTUBE", "https://youtube.com/channel/UC_x5XG1OV2P6uZZ5FSM9Ttw"),
    "UC_x5XG1OV2P6uZZ5FSM9Ttw"
  );
  assert.equal(await normalizeTarget("YOUTUBE", "UC_x5XG1OV2P6uZZ5FSM9Ttw"), "UC_x5XG1OV2P6uZZ5FSM9Ttw");
  // Neither an id nor a recognisable handle/URL shape - rejected before any
  // network lookup would even be attempted.
  await assert.rejects(() => normalizeTarget("YOUTUBE", "just some text"), /channel id.*URL.*handle/s);
});

test("a youtube handle or custom URL is recognised as needing a lookup, not rejected on sight", () => {
  assert.equal(youtubeHandlePath("@MrBeast"), "@MrBeast");
  assert.equal(youtubeHandlePath("https://youtube.com/@MrBeast"), "@MrBeast");
  assert.equal(youtubeHandlePath("youtube.com/c/OldStyleName"), "c/OldStyleName");
  assert.equal(youtubeHandlePath("https://www.youtube.com/user/EvenOlder"), "user/EvenOlder");
  assert.equal(youtubeHandlePath("not a handle at all"), null);
  assert.equal(youtubeHandlePath("UC_x5XG1OV2P6uZZ5FSM9Ttw"), null, "a bare id is not a handle path");
});

test("the channel id is pulled from wherever the channel page put it", () => {
  assert.equal(
    extractChannelIdFromHtml('{"channelId":"UC_x5XG1OV2P6uZZ5FSM9Ttw","other":"stuff"}'),
    "UC_x5XG1OV2P6uZZ5FSM9Ttw"
  );
  assert.equal(
    extractChannelIdFromHtml('<link rel="canonical" href="https://www.youtube.com/channel/UC_x5XG1OV2P6uZZ5FSM9Ttw">'),
    "UC_x5XG1OV2P6uZZ5FSM9Ttw"
  );
  assert.equal(
    extractChannelIdFromHtml('<meta itemprop="channelId" content="UC_x5XG1OV2P6uZZ5FSM9Ttw">'),
    "UC_x5XG1OV2P6uZZ5FSM9Ttw"
  );
  assert.equal(extractChannelIdFromHtml("<html>no channel id anywhere in here</html>"), null);
});

test("github targets normalise to owner/repo", async () => {
  assert.equal(await normalizeTarget("GITHUB", "https://github.com/discordjs/discord.js"), "discordjs/discord.js");
  assert.equal(await normalizeTarget("GITHUB", "discordjs/discord.js.git"), "discordjs/discord.js");
  await assert.rejects(() => normalizeTarget("GITHUB", "discordjs"), /owner\/repo/);
});

test("rss targets must be http urls", async () => {
  assert.equal(await normalizeTarget("RSS", "https://example.com/feed.xml"), "https://example.com/feed.xml");
  await assert.rejects(() => normalizeTarget("RSS", "ftp://example.com/feed"), /http and https/);
  await assert.rejects(() => normalizeTarget("RSS", "not a url"), /valid feed URL/);
  await assert.rejects(() => normalizeTarget("RSS", ""), /Provide what should be watched/);
});

test("trovo targets accept a url or a bare channel name", async () => {
  assert.equal(await normalizeTarget("TROVO", "https://trovo.live/SomeStreamer"), "somestreamer");
  assert.equal(await normalizeTarget("TROVO", "trovo.live/s/SomeStreamer?from=search"), "somestreamer");
  assert.equal(await normalizeTarget("TROVO", "SomeStreamer"), "somestreamer");
  await assert.rejects(() => normalizeTarget("TROVO", "no"), FeedError, "below Trovo's own minimum username length");
});

test("every registered feed type has a provider, a style and dashboard support", () => {
  for (const type of FEED_TYPES) {
    assert.ok(PROVIDERS[type], `${type} has no fetch provider`);
    assert.ok(TYPE_STYLE[type], `${type} has no announcement style`);
    assert.ok(SUPPORTED_TYPES.includes(type), `${type} is not offered on the dashboard`);
  }
});

test("vk targets accept a url, a bare name, or a numeric community id", async () => {
  assert.equal(await normalizeTarget("VK", "https://vk.com/durov"), "durov");
  assert.equal(await normalizeTarget("VK", "vk.com/club1"), "-1");
  assert.equal(await normalizeTarget("VK", "public228"), "-228");
  assert.equal(await normalizeTarget("VK", "123456"), "-123456");
  assert.equal(await normalizeTarget("VK", "-123456"), "-123456");
  assert.equal(await normalizeTarget("VK", "some_community.name"), "some_community.name");
  await assert.rejects(() => normalizeTarget("VK", "0"), FeedError);
  await assert.rejects(() => normalizeTarget("VK", "!"), /valid VK community/);
});

test("a VK keyword filter is case-insensitive and matches the post text", () => {
  const post = { text: "We just SHIPPED a new update", attachments: [] };
  assert.equal(matchesVkFilters(post, { keyword: "shipped" }), true);
  assert.equal(matchesVkFilters(post, { keyword: "cancelled" }), false);
  assert.equal(matchesVkFilters(post, {}), true, "no filter means every post matches");
});

test("a VK attachment filter only passes a post carrying that attachment type", () => {
  const withPhoto = { text: "", attachments: [{ type: "photo" }] };
  const withVideo = { text: "", attachments: [{ type: "video" }] };
  const withNone = { text: "", attachments: [] };

  assert.equal(matchesVkFilters(withPhoto, { attachmentType: "PHOTO" }), true);
  assert.equal(matchesVkFilters(withVideo, { attachmentType: "PHOTO" }), false);
  assert.equal(matchesVkFilters(withNone, { attachmentType: "PHOTO" }), false);
});

test("both VK filters must pass for a post to match", () => {
  const post = { text: "release notes", attachments: [{ type: "photo" }] };
  assert.equal(matchesVkFilters(post, { keyword: "release", attachmentType: "PHOTO" }), true);
  assert.equal(matchesVkFilters(post, { keyword: "release", attachmentType: "VIDEO" }), false);
  assert.equal(matchesVkFilters(post, { keyword: "nope", attachmentType: "PHOTO" }), false);
});

test("a VK announcement carries the community's own post link", () => {
  const payload = buildAnnouncement(
    { type: "VK", target: "durov", mention: null, message: null },
    {
      id: "555",
      title: "New post",
      link: "https://vk.com/wall-1_555",
      publishedAt: new Date("2026-07-30T12:00:00.000Z"),
      extra: { author: "Pavel Durov's channel" },
    }
  );

  assert.match(payload.content, /posted/);
  assert.equal(payload.embeds[0].data.author.name, "VK · Pavel Durov's channel");
});

test("dashboard VK filters are only ever stored for a VK subscription", () => {
  assert.deepEqual(vkFilters("VK", { keyword: " new release ", attachmentType: "photo" }), {
    keyword: "new release",
    attachmentType: "PHOTO",
  });
  assert.deepEqual(vkFilters("VK", {}), { keyword: null, attachmentType: null });
  assert.deepEqual(vkFilters("VK", { attachmentType: "not-a-real-type" }), { keyword: null, attachmentType: null });
  assert.deepEqual(vkFilters("TWITCH", { keyword: "ignored", attachmentType: "PHOTO" }), {
    keyword: null,
    attachmentType: null,
  });
});

/* ---------------------------------------------------------- credential safety */

test("a request error never carries a query string a token could be sitting in", () => {
  assert.equal(
    redactedUrl("https://api.vk.com/method/wall.get?access_token=SECRET&v=5.199"),
    "https://api.vk.com/method/wall.get"
  );
  assert.equal(
    redactedUrl("https://id.twitch.tv/oauth2/token?client_secret=SECRET"),
    "https://id.twitch.tv/oauth2/token"
  );
  assert.equal(redactedUrl("not a url"), "the feed provider");
});

test("a connection failure surfaces as a FeedError with the credential-bearing query string stripped", async () => {
  const secretToken = "super-secret-token-do-not-leak";
  await assert.rejects(
    () => request(`http://127.0.0.1:1/?access_token=${secretToken}`),
    (error) => {
      assert.ok(error instanceof FeedError, "network failures are reported as FeedError, not a raw fetch error");
      assert.doesNotMatch(error.message, new RegExp(secretToken), "the token must never appear in a stored error");
      assert.match(error.message, /http:\/\/127\.0\.0\.1:1\//);
      return true;
    }
  );
});

test("a Trovo stream announces with its game and viewer count, like Twitch", () => {
  const payload = buildAnnouncement(
    { type: "TROVO", target: "somestreamer", mention: null, message: null },
    {
      id: "streamer-id:12345",
      title: "Late night raid",
      link: "https://trovo.live/somestreamer",
      publishedAt: new Date("2026-07-30T12:00:00.000Z"),
      extra: { author: "SomeStreamer", game: "Valorant", viewers: 88 },
    }
  );

  assert.match(payload.content, /SomeStreamer is live/);
  const embed = payload.embeds[0].data;
  assert.equal(embed.author.name, "Trovo · SomeStreamer");
  assert.match(embed.description, /Valorant/);
  assert.match(embed.description, /88/);
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
