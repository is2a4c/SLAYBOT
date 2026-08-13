const test = require("node:test");
const assert = require("node:assert/strict");
require("module-alias/register");

const {
  antispamCache,
  isRepeatedMessage,
  matchesContentFilter,
  shouldBlockInvites,
  shouldBlockLinks,
  splitFilterEntries,
  inspectCaps,
  countEmoji,
  inspectZalgo,
  matchesScam,
} = require("../src/handlers/automod");

test.beforeEach(() => antispamCache.clear());

test("word filters support phrases, whole words, exact messages and exceptions", () => {
  assert.equal(
    matchesContentFilter("Get FREE coins now", { filter_enabled: true, filter_terms: "free coins" }),
    "free coins"
  );
  assert.equal(
    matchesContentFilter("classical music", { filter_enabled: true, filter_terms: "ass", filter_match_mode: "WORD" }),
    null
  );
  assert.equal(
    matchesContentFilter("ass", { filter_enabled: true, filter_terms: "ass", filter_match_mode: "WORD" }),
    "ass"
  );
  assert.equal(
    matchesContentFilter("blocked phrase is explained", {
      filter_enabled: true,
      filter_terms: "blocked phrase",
      filter_exceptions: "blocked phrase is explained",
    }),
    null
  );
  assert.equal(
    matchesContentFilter("ONLY THIS", {
      filter_enabled: true,
      filter_terms: "only this",
      filter_match_mode: "EXACT",
      filter_case_sensitive: true,
    }),
    null
  );
});

test("filter lists are trimmed, bounded and accept lines or commas", () => {
  assert.deepEqual(splitFilterEntries(" one\ntwo, three ,,"), ["one", "two", "three"]);
  assert.equal(splitFilterEntries(Array.from({ length: 120 }, (_, index) => `x${index}`).join(",")).length, 100);
});

test("link filters implement all, allowlist and blocklist modes including subdomains", () => {
  assert.equal(shouldBlockLinks("https://example.com/a", { anti_links: true, link_mode: "ALL" }), true);
  assert.equal(
    shouldBlockLinks("https://cdn.example.com/a", {
      anti_links: true,
      link_mode: "ALLOWLIST",
      link_domains: "example.com",
    }),
    false
  );
  assert.equal(
    shouldBlockLinks("https://evil.example/a", {
      anti_links: true,
      link_mode: "BLOCKLIST",
      link_domains: "evil.example",
    }),
    true
  );
  assert.equal(
    shouldBlockLinks("https://example.com.evil.test/a", {
      anti_links: true,
      link_mode: "ALLOWLIST",
      link_domains: "example.com",
    }),
    true
  );
});

test("invite filter permits only configured invite codes", () => {
  const config = { anti_invites: true, allowed_invite_codes: "safeCode, second" };
  assert.equal(shouldBlockInvites("join discord.gg/safeCode", config), false);
  assert.equal(shouldBlockInvites("join discord.gg/other", config), true);
  assert.equal(shouldBlockInvites("join discord.gg/safeCode and discord.gg/other", config), true);
});

test("repeat detection honours the configured window and repeat count", () => {
  const message = { author: { id: "1" }, guildId: "2", content: "same" };
  const config = { spam_window_seconds: 10, spam_max_repeats: 3 };

  assert.equal(isRepeatedMessage(message, config, 1000), false);
  assert.equal(isRepeatedMessage(message, config, 2000), false);
  assert.equal(isRepeatedMessage(message, config, 3000), true);
  assert.equal(isRepeatedMessage(message, config, 14000), false, "the counter resets outside the window");
});

test("CAPS inspection counts Unicode letters without treating digits as uppercase", () => {
  assert.deepEqual(inspectCaps("HELLO 123 мир"), { letters: 8, percent: 63 });
  assert.deepEqual(inspectCaps("123 !!!"), { letters: 0, percent: 0 });
});

test("emoji inspection counts Unicode and Discord custom emoji", () => {
  assert.equal(countEmoji("😀🔥 <:party:123456789012345678>"), 3);
  assert.equal(countEmoji("plain text"), 0);
});

test("Zalgo inspection measures combining marks after Unicode decomposition", () => {
  assert.equal(inspectZalgo("plain").percent, 0);
  const result = inspectZalgo("z̵̛͝a̶̕l̷g̴o̷");
  assert.ok(result.marks >= 5);
  assert.ok(result.percent >= 100);
});

test("scam detection requires a suspicious host or multiple social-engineering signals", () => {
  assert.equal(matchesScam("Free Nitro — verify now https://example.test/login"), true);
  assert.equal(matchesScam("Read about free software at https://example.test"), false);
  assert.equal(matchesScam("https://discord-nitro.gift/claim"), true);
});
