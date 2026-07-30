const test = require("node:test");
const assert = require("node:assert/strict");
require("module-alias/register");

const { matchesEmoji, resolveMirrorAction, buildStarboardMessage } = require("../src/handlers/starboard");
const { shouldRepost, buildStickyPayload } = require("../src/handlers/stickyMessages");

/* ------------------------------------------------------------------ starboard */

test("the configured emoji is matched for unicode and custom emoji", () => {
  assert.equal(matchesEmoji({ name: "⭐", id: null }, "⭐"), true);
  assert.equal(matchesEmoji({ name: "🌟", id: null }, "⭐"), false);
  assert.equal(matchesEmoji({ name: "star", id: "123456789012345678" }, "<:star:123456789012345678>"), true);
  assert.equal(matchesEmoji({ name: "star", id: "999999999999999999" }, "<:star:123456789012345678>"), false);
  assert.equal(matchesEmoji({ name: "⭐", id: null }, ""), false);
});

test("a message crossing the threshold is mirrored once and then updated", () => {
  assert.equal(resolveMirrorAction({ count: 2, threshold: 3, hasMirror: false }), "none");
  assert.equal(resolveMirrorAction({ count: 3, threshold: 3, hasMirror: false }), "create");
  assert.equal(resolveMirrorAction({ count: 8, threshold: 3, hasMirror: true }), "update");
});

test("dropping below the threshold removes the mirror unless the guild keeps it", () => {
  assert.equal(resolveMirrorAction({ count: 1, threshold: 3, hasMirror: true }), "delete");
  assert.equal(resolveMirrorAction({ count: 1, threshold: 3, hasMirror: true, removeBelow: false }), "update");
});

test("an entry blocked by staff is never re-created", () => {
  assert.equal(resolveMirrorAction({ count: 50, threshold: 3, hasMirror: false, blocked: true }), "none");
});

test("the mirror carries the jump link, the count and the first image", () => {
  const attachments = new Map([
    ["1", { id: "1", name: "shot.png", contentType: "image/png", url: "https://cdn/shot.png" }],
    ["2", { id: "2", name: "log.txt", contentType: "text/plain", url: "https://cdn/log.txt" }],
  ]);
  attachments.find = (fn) => [...attachments.values()].find(fn);
  attachments.filter = (fn) => {
    const kept = [...attachments.values()].filter(fn);
    return { size: kept.length, map: (mapper) => kept.map(mapper) };
  };

  const payload = buildStarboardMessage(
    {
      content: "look at this",
      url: "https://discord.com/channels/1/2/3",
      channelId: "2",
      createdAt: new Date("2026-07-30T00:00:00.000Z"),
      author: { username: "ann", globalName: null, displayAvatarURL: () => "https://cdn/avatar.png" },
      attachments,
    },
    7,
    { emoji: "⭐", color: "#FFCC00" }
  );

  assert.match(payload.content, /⭐ \*\*7\*\* · <#2>/);
  const embed = payload.embeds[0].data;
  assert.match(embed.description, /look at this/);
  assert.match(embed.description, /\[Jump to message\]\(https:\/\/discord\.com\/channels\/1\/2\/3\)/);
  assert.equal(embed.image.url, "https://cdn/shot.png");
  assert.match(embed.fields[0].value, /log\.txt/);
});

/* ------------------------------------------------------------ sticky messages */

const sticky = (overrides = {}) => ({
  enabled: true,
  min_messages: 3,
  cooldown_seconds: 10,
  last_posted_at: null,
  content: "read the rules",
  ...overrides,
});

test("a sticky waits for the configured number of messages", () => {
  assert.equal(shouldRepost({ sticky: sticky(), messagesSince: 2 }), false);
  assert.equal(shouldRepost({ sticky: sticky(), messagesSince: 3 }), true);
});

test("a sticky respects its cooldown", () => {
  const now = Date.now();
  const recent = sticky({ last_posted_at: new Date(now - 3000) });
  const old = sticky({ last_posted_at: new Date(now - 30_000) });

  assert.equal(shouldRepost({ sticky: recent, messagesSince: 5, now }), false);
  assert.equal(shouldRepost({ sticky: old, messagesSince: 5, now }), true);
});

test("a disabled sticky never reposts", () => {
  assert.equal(shouldRepost({ sticky: sticky({ enabled: false }), messagesSince: 99 }), false);
});

test("stickies render as an embed by default and as plain text on request", () => {
  const embedPayload = buildStickyPayload(sticky({ embed: true, title: "Rules", color: "#123456" }));
  assert.equal(embedPayload.embeds[0].data.title, "Rules");
  assert.equal(embedPayload.embeds[0].data.description, "read the rules");

  const plainPayload = buildStickyPayload(sticky({ embed: false }));
  assert.deepEqual(plainPayload, { content: "read the rules" });
});
