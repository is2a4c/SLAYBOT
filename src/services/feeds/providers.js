const fetch = require("node-fetch");

const USER_AGENT = "SLAYBOT feed watcher";
const REQUEST_TIMEOUT_MS = 10_000;

class FeedError extends Error {
  constructor(message) {
    super(message);
    this.name = "FeedError";
  }
}

/**
 * @param {string} url
 * @param {object} [options]
 */
async function request(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: { "user-agent": USER_AGENT, ...(options.headers || {}) },
    });
    return response;
  } finally {
    clearTimeout(timer);
  }
}

/* --------------------------------------------------------------------- parsing */

/**
 * Minimal feed reader for RSS 2.0 and Atom. A full XML parser is not worth a
 * dependency here: feeds only need the newest entry's id, title, link and date.
 *
 * @param {string} xml
 * @returns {{title: string|null, items: {id: string, title: string, link: string, publishedAt: Date|null, author: string|null}[]}}
 */
function parseFeed(xml) {
  const text = String(xml || "");
  const decode = (value) =>
    String(value || "")
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, "&")
      .replace(/<[^>]+>/g, "")
      .trim();

  const tag = (block, name) => {
    const match = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
    return match ? decode(match[1]) : null;
  };

  const feedTitle = tag(text.split(/<(?:item|entry)[\s>]/i)[0] || "", "title");

  const blocks = [...text.matchAll(/<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi)].map((match) => match[2]);

  const items = blocks.map((block) => {
    // Atom keeps the url in an attribute, RSS in the element body.
    const atomLink = block.match(/<link[^>]*href="([^"]+)"[^>]*\/?>/i);
    const link = atomLink ? decode(atomLink[1]) : tag(block, "link") || "";
    const published = tag(block, "published") || tag(block, "updated") || tag(block, "pubDate");
    const parsedDate = published ? new Date(published) : null;

    return {
      id: tag(block, "guid") || tag(block, "id") || link || tag(block, "title") || "",
      title: tag(block, "title") || "Untitled",
      link,
      publishedAt: parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate : null,
      author: tag(block, "name") || tag(block, "author") || tag(block, "dc:creator"),
    };
  });

  return { title: feedTitle, items: items.filter((item) => item.id) };
}

/**
 * Normalise what a user typed into the identifier the provider needs.
 * @param {string} type
 * @param {string} input
 */
function normalizeTarget(type, input) {
  const value = String(input || "").trim();
  if (!value) throw new FeedError("Provide what should be watched.");

  if (type === "TWITCH") {
    const match = value.match(/^(?:https?:\/\/)?(?:www\.)?twitch\.tv\/([a-zA-Z0-9_]{3,25})\/?$/) || [];
    const login = (match[1] || value).toLowerCase();
    if (!/^[a-z0-9_]{3,25}$/.test(login)) throw new FeedError("That is not a valid Twitch channel name.");
    return login;
  }

  if (type === "YOUTUBE") {
    const idMatch = value.match(/(UC[\w-]{22})/);
    if (idMatch) return idMatch[1];
    throw new FeedError(
      "Provide the YouTube channel id (starts with `UC`). Open the channel, then About → Share → Copy channel ID."
    );
  }

  if (type === "GITHUB") {
    const match = value.match(/^(?:https?:\/\/github\.com\/)?([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/);
    if (!match) throw new FeedError("Provide the repository as `owner/repo`.");
    return `${match[1]}/${match[2]}`;
  }

  if (type === "RSS") {
    let url;
    try {
      url = new URL(value);
    } catch {
      throw new FeedError("Provide a valid feed URL.");
    }
    if (!["http:", "https:"].includes(url.protocol)) throw new FeedError("Only http and https feeds are supported.");
    return url.toString();
  }

  throw new FeedError(`Unknown feed type ${type}.`);
}

/* ------------------------------------------------------------------- providers */

/**
 * Twitch needs an app access token; it is cached until shortly before it expires.
 */
let twitchToken = { value: null, expiresAt: 0 };

async function getTwitchToken() {
  const clientId = process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new FeedError("Twitch alerts need TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET in the environment.");
  }

  if (twitchToken.value && twitchToken.expiresAt > Date.now() + 60_000) return twitchToken.value;

  const response = await request(
    `https://id.twitch.tv/oauth2/token?client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(
      clientSecret
    )}&grant_type=client_credentials`,
    { method: "POST" }
  );

  if (!response.ok) throw new FeedError(`Twitch rejected the credentials (${response.status}).`);

  const body = await response.json();
  twitchToken = { value: body.access_token, expiresAt: Date.now() + (body.expires_in || 3600) * 1000 };
  return twitchToken.value;
}

/**
 * @param {string} login
 * @returns {Promise<{id: string, title: string, link: string, publishedAt: Date|null, extra: object}|null>}
 */
async function fetchTwitch(login) {
  const token = await getTwitchToken();
  const response = await request(`https://api.twitch.tv/helix/streams?user_login=${encodeURIComponent(login)}`, {
    headers: { "client-id": process.env.TWITCH_CLIENT_ID, authorization: `Bearer ${token}` },
  });

  if (response.status === 401) {
    twitchToken = { value: null, expiresAt: 0 };
    throw new FeedError("Twitch token expired; it will be renewed on the next check.");
  }
  if (!response.ok) throw new FeedError(`Twitch API returned ${response.status}.`);

  const body = await response.json();
  const stream = body.data?.[0];
  if (!stream) return null; // offline

  return {
    // The stream id changes per broadcast, so a restart never re-announces the same one.
    id: stream.id,
    title: stream.title || `${stream.user_name} is live`,
    link: `https://twitch.tv/${stream.user_login}`,
    publishedAt: stream.started_at ? new Date(stream.started_at) : null,
    extra: {
      author: stream.user_name,
      game: stream.game_name,
      viewers: stream.viewer_count,
      thumbnail: stream.thumbnail_url?.replace("{width}", "1280").replace("{height}", "720"),
    },
  };
}

/**
 * YouTube uploads are read from the public Atom feed: no API key, no quota.
 * @param {string} channelId
 */
async function fetchYouTube(channelId) {
  const response = await request(
    `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`
  );
  if (response.status === 404) throw new FeedError("That YouTube channel id does not exist.");
  if (!response.ok) throw new FeedError(`YouTube returned ${response.status}.`);

  const { items } = parseFeed(await response.text());
  const latest = items[0];
  if (!latest) return null;

  const videoId = latest.id.replace("yt:video:", "");
  return {
    id: latest.id,
    title: latest.title,
    link: latest.link || `https://www.youtube.com/watch?v=${videoId}`,
    publishedAt: latest.publishedAt,
    extra: { author: latest.author, thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` },
  };
}

/**
 * @param {string} url
 */
async function fetchRss(url) {
  const response = await request(url);
  if (!response.ok) throw new FeedError(`The feed returned ${response.status}.`);

  const { title, items } = parseFeed(await response.text());
  const latest = items[0];
  if (!latest) return null;

  return {
    id: latest.id,
    title: latest.title,
    link: latest.link,
    publishedAt: latest.publishedAt,
    extra: { author: latest.author, source: title },
  };
}

/**
 * @param {string} repo owner/repo
 */
async function fetchGitHub(repo) {
  const headers = {};
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

  const response = await request(`https://api.github.com/repos/${repo}/releases/latest`, { headers });

  // A repository without releases falls back to its commit feed.
  if (response.status === 404) {
    const commits = await request(`https://api.github.com/repos/${repo}/commits?per_page=1`, { headers });
    if (commits.status === 404) throw new FeedError(`Repository \`${repo}\` was not found.`);
    if (!commits.ok) throw new FeedError(`GitHub returned ${commits.status}.`);

    const [commit] = await commits.json();
    if (!commit) return null;

    return {
      id: commit.sha,
      title: (commit.commit?.message || "New commit").split("\n")[0].slice(0, 200),
      link: commit.html_url,
      publishedAt: commit.commit?.author?.date ? new Date(commit.commit.author.date) : null,
      extra: { author: commit.author?.login || commit.commit?.author?.name, kind: "commit" },
    };
  }

  if (!response.ok) throw new FeedError(`GitHub returned ${response.status}.`);

  const release = await response.json();
  return {
    id: String(release.id),
    title: release.name || release.tag_name || "New release",
    link: release.html_url,
    publishedAt: release.published_at ? new Date(release.published_at) : null,
    extra: { author: release.author?.login, kind: "release", body: release.body },
  };
}

const PROVIDERS = {
  TWITCH: fetchTwitch,
  YOUTUBE: fetchYouTube,
  RSS: fetchRss,
  GITHUB: fetchGitHub,
};

/**
 * @param {string} type
 * @param {string} target
 */
function fetchLatest(type, target) {
  const provider = PROVIDERS[type];
  if (!provider) throw new FeedError(`Unknown feed type ${type}.`);
  return provider(target);
}

module.exports = {
  FeedError,
  PROVIDERS,
  REQUEST_TIMEOUT_MS,
  fetchGitHub,
  fetchLatest,
  fetchRss,
  fetchTwitch,
  fetchYouTube,
  normalizeTarget,
  parseFeed,
};
