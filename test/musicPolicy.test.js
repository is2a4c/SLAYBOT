const test = require("node:test");
const assert = require("node:assert/strict");
require("module-alias/register");

const {
  applyQueueLimits,
  musicConfig,
  musicProblem,
  noticeSeconds,
  NOTICE_DELETE_SECONDS,
  searchIdentifier,
} = require("@src/services/music/policy");
const { hasAvailableNode } = require("@helpers/LavalinkUtils");
const { startAutoplay } = require("@helpers/MusicPlayer");

const ROLE_ID = "100000000000000001";
const OTHER_ROLE_ID = "100000000000000002";
const CHANNEL_ID = "200000000000000001";
const OTHER_CHANNEL_ID = "200000000000000002";

function settingsWith(music) {
  return { control_center: { music } };
}

function member(...roleIds) {
  const held = new Set(roleIds);
  return { roles: { cache: { has: (id) => held.has(id) } } };
}

/* ------------------------------------------------------------- musicConfig */

test("musicConfig reads control_center.music, or nothing at all", () => {
  assert.equal(musicConfig(settingsWith({ channel_id: CHANNEL_ID })).channel_id, CHANNEL_ID);
  assert.equal(musicConfig(null), null);
  assert.equal(musicConfig({}), null);
});

/* --------------------------------------------------------- searchIdentifier */

test("a URL is searched verbatim, never prefixed", () => {
  assert.equal(searchIdentifier("https://youtu.be/x", settingsWith({})), "https://youtu.be/x");
});

test("the server's chosen source wins over the static default", () => {
  const settings = settingsWith({ default_source: "SOUNDCLOUD" });
  assert.equal(searchIdentifier("lofi", settings, "YT"), "scsearch:lofi");
});

test("an unset source falls back to config.js's legacy default, then to YouTube", () => {
  assert.equal(searchIdentifier("lofi", settingsWith({}), "YTM"), "ytmsearch:lofi");
  assert.equal(searchIdentifier("lofi", settingsWith({}), undefined), "ytsearch:lofi");
  assert.equal(searchIdentifier("lofi", null, undefined), "ytsearch:lofi");
});

/* ------------------------------------------------------------- musicProblem */

const BAN = { name: "ban", category: "MODERATION" };
const SKIP = { name: "skip", category: "MUSIC" };
const QUEUE = { name: "queue", category: "MUSIC" };

test("only MUSIC commands are ever asked about", () => {
  assert.equal(musicProblem(settingsWith({ channel_id: CHANNEL_ID, allow_any_channel: false }), BAN, {}), null);
});

test("a server that never touched music settings restricts nothing", () => {
  assert.equal(musicProblem(settingsWith(null), SKIP, {}), null);
  assert.equal(musicProblem(null, SKIP, {}), null);
});

test("a dedicated music channel refuses commands used elsewhere", () => {
  const settings = settingsWith({ channel_id: CHANNEL_ID, allow_any_channel: false });
  assert.equal(musicProblem(settings, SKIP, { channelId: CHANNEL_ID }), null);
  assert.match(musicProblem(settings, SKIP, { channelId: OTHER_CHANNEL_ID }), /can only be used in/);
});

test("allowing any channel lifts the restriction even with a channel configured", () => {
  const settings = settingsWith({ channel_id: CHANNEL_ID, allow_any_channel: true });
  assert.equal(musicProblem(settings, SKIP, { channelId: OTHER_CHANNEL_ID }), null);
});

test("DJ roles gate control commands, never browsing commands", () => {
  const settings = settingsWith({ dj_roles: [ROLE_ID] });
  assert.match(musicProblem(settings, SKIP, { member: member(OTHER_ROLE_ID) }), /DJ role/);
  assert.equal(musicProblem(settings, SKIP, { member: member(ROLE_ID) }), null);
  assert.equal(
    musicProblem(settings, QUEUE, { member: member(OTHER_ROLE_ID) }),
    null,
    "queue is browsing, not control"
  );
});

test("a control command with no member to check refuses, same as an unheld role", () => {
  const settings = settingsWith({ dj_roles: [ROLE_ID] });
  assert.match(musicProblem(settings, SKIP, {}), /DJ role/);
});

/* ---------------------------------------------------------- applyQueueLimits */

function track(lengthMs, requester = "alice") {
  return { info: { length: lengthMs }, requester };
}

test("tracks longer than the server's limit are dropped", () => {
  const settings = settingsWith({ max_track_minutes: 5 });
  const result = applyQueueLimits([track(3 * 60_000), track(10 * 60_000)], settings, { requesterName: "alice" });
  assert.equal(result.tracks.length, 1);
  assert.equal(result.droppedForLength, 1);
  assert.equal(result.droppedForQuota, 0);
});

test("a member's own quota only counts their own queued tracks", () => {
  const settings = settingsWith({ max_queue_per_user: 2 });
  const existing = [{ requester: "alice" }, { requester: "bob" }, { requester: "bob" }];
  const result = applyQueueLimits([track(60_000), track(60_000), track(60_000)], settings, {
    existingTracks: existing,
    requesterName: "alice",
  });
  // alice already has 1 queued, room for 1 more before hitting the cap of 2.
  assert.equal(result.tracks.length, 1);
  assert.equal(result.droppedForQuota, 2);
});

test("length is checked before quota, so a too-long track never eats a quota slot", () => {
  const settings = settingsWith({ max_track_minutes: 5, max_queue_per_user: 1 });
  const result = applyQueueLimits([track(10 * 60_000), track(60_000)], settings, { requesterName: "alice" });
  assert.equal(result.tracks.length, 1);
  assert.equal(result.droppedForLength, 1);
  assert.equal(result.droppedForQuota, 0);
});

test("missing settings fall back to the module's own defaults, not unlimited", () => {
  const result = applyQueueLimits([track(200 * 60_000)], null, { requesterName: "alice" });
  assert.equal(result.tracks.length, 0);
  assert.equal(result.droppedForLength, 1);
});

/* ----------------------------------------------------------- noticeSeconds */

test("notice cleanup is opt-in and off by default", () => {
  assert.equal(noticeSeconds(settingsWith({ delete_notices: true })), NOTICE_DELETE_SECONDS);
  assert.equal(noticeSeconds(settingsWith({ delete_notices: false })), undefined);
  assert.equal(noticeSeconds(settingsWith({})), undefined);
  assert.equal(noticeSeconds(null), undefined);
});

/* -------------------------------------------------------- hasAvailableNode */

test("availability reflects the sockets actually connected, not just configured", () => {
  const up = { nodes: new Map([["a", { ws: { active: true } }]]) };
  const down = { nodes: new Map([["a", { ws: { active: false } }]]) };
  const mixed = {
    nodes: new Map([
      ["a", { ws: { active: false } }],
      ["b", { ws: { active: true } }],
    ]),
  };

  assert.equal(hasAvailableNode(up), true);
  assert.equal(hasAvailableNode(down), false);
  assert.equal(hasAvailableNode(mixed), true);
  assert.equal(hasAvailableNode({ nodes: new Map() }), false);
  assert.equal(hasAvailableNode(null), false);
});

/* --------------------------------------------------------------- autoplay */

function fakeGuild(channels = {}) {
  return {
    id: "guild-1",
    channels: {
      cache: new Map(Object.entries(channels)),
    },
  };
}

function textChannel(id) {
  return { id, isTextBased: () => true, isThread: () => false };
}

function fakeManager(loadResult) {
  return {
    api: {
      loadTracks: async () => loadResult,
    },
  };
}

function fakeQueue(channel) {
  const added = [];
  return {
    data: { channel },
    add: (tracks, options) => added.push({ tracks, options }),
    added,
    started: false,
    start: async function () {
      this.started = true;
    },
  };
}

test("autoplay does nothing when no query was ever configured", async () => {
  const queue = fakeQueue(textChannel(CHANNEL_ID));
  const restarted = await startAutoplay({
    manager: fakeManager({}),
    guild: fakeGuild(),
    queue,
    config: { autoplay_query: "" },
  });
  assert.equal(restarted, false);
  assert.equal(queue.started, false);
});

test("autoplay prefers its configured output channel", async () => {
  const output = textChannel(OTHER_CHANNEL_ID);
  const guild = fakeGuild({ [OTHER_CHANNEL_ID]: output });
  const queue = fakeQueue(textChannel(CHANNEL_ID));
  const manager = fakeManager({
    loadType: "search",
    data: [{ encoded: "track-1", info: { title: "Lofi beats", uri: "https://x", length: 60_000 } }],
  });

  const restarted = await startAutoplay({
    manager,
    guild,
    queue,
    config: { autoplay_query: "lofi", autoplay_output_channel: OTHER_CHANNEL_ID },
  });

  assert.equal(restarted, true);
  assert.equal(queue.data.channel, output, "the configured channel wins over the old one");
  assert.equal(queue.started, true);
  assert.equal(queue.added[0].options.requester, "Autoplay");
  assert.equal(queue.added[0].tracks[0].track, "track-1");
});

test("a missing or non-text configured channel falls back to the queue's own channel", async () => {
  const fallback = textChannel(CHANNEL_ID);
  const queue = fakeQueue(fallback);
  const manager = fakeManager({
    loadType: "search",
    data: [{ encoded: "track-1", info: { title: "Lofi beats", uri: "https://x", length: 60_000 } }],
  });

  const restarted = await startAutoplay({
    manager,
    guild: fakeGuild(),
    queue,
    config: { autoplay_query: "lofi", autoplay_output_channel: "999999999999999999" },
  });

  assert.equal(restarted, true);
  assert.equal(queue.data.channel, fallback);
});

test("no usable channel at all means autoplay quietly declines", async () => {
  const queue = fakeQueue(null);
  const restarted = await startAutoplay({
    manager: fakeManager({}),
    guild: fakeGuild(),
    queue,
    config: { autoplay_query: "lofi" },
  });
  assert.equal(restarted, false);
});

test("no search results means autoplay declines instead of queuing nothing", async () => {
  const queue = fakeQueue(textChannel(CHANNEL_ID));
  const manager = fakeManager({ loadType: "empty", data: {} });
  const warnings = [];

  const restarted = await startAutoplay({
    manager,
    guild: fakeGuild(),
    queue,
    config: { autoplay_query: "silence" },
    logger: { warn: (line) => warnings.push(line) },
  });

  assert.equal(restarted, false);
  assert.equal(queue.started, false);
  assert.equal(warnings.length, 1);
});

test("Lavalink refusing the search fails safely rather than throwing", async () => {
  const queue = fakeQueue(textChannel(CHANNEL_ID));
  const manager = {
    api: {
      loadTracks: async () => {
        throw new Error("node offline");
      },
    },
  };
  const errors = [];

  const restarted = await startAutoplay({
    manager,
    guild: fakeGuild(),
    queue,
    config: { autoplay_query: "lofi" },
    logger: { error: (line) => errors.push(line) },
  });

  assert.equal(restarted, false);
  assert.equal(errors.length, 1);
});
