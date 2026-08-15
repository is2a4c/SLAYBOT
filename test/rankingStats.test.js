const test = require("node:test");
const assert = require("node:assert/strict");
require("module-alias/register");

const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const {
  DEFAULT_MAX_MEMBERS,
  VOICE_XP_PER_MINUTE,
  cardStyle,
  leaderboardLimit,
  memberIgnored,
  publicPageEnabled,
  resetOnLeave,
  textMultiplier,
  textXpIgnored,
  voiceMultiplier,
  voiceXpEnabled,
  voiceXpForSeconds,
  voiceXpIgnored,
} = require("@src/services/stats/RankingPolicy");
const { buildRankCardUrl } = require("@src/services/stats/RankCard");

const ROLE_ID = "100000000000000001";
const OTHER_ROLE_ID = "100000000000000002";
const CHANNEL_ID = "200000000000000001";
const OTHER_CHANNEL_ID = "200000000000000002";

function settingsWith(ranking) {
  return { control_center: { ranking } };
}

function member(...roleIds) {
  const held = new Set(roleIds);
  return { roles: { cache: { has: (id) => held.has(id) } } };
}

/* ------------------------------------------------------------ RankingPolicy */

test("memberIgnored is false with no ignored roles configured, true only for a held one", () => {
  assert.equal(memberIgnored(settingsWith({}), member(ROLE_ID)), false);
  const settings = settingsWith({ ignored_roles: [ROLE_ID] });
  assert.equal(memberIgnored(settings, member(ROLE_ID)), true);
  assert.equal(memberIgnored(settings, member(OTHER_ROLE_ID)), false);
});

test("textXpIgnored checks the member's roles first, then the channel list", () => {
  const settings = settingsWith({ ignored_roles: [ROLE_ID], ignored_text_channels: [CHANNEL_ID] });
  assert.equal(
    textXpIgnored(settings, member(ROLE_ID), OTHER_CHANNEL_ID),
    true,
    "an ignored member earns nothing anywhere"
  );
  assert.equal(textXpIgnored(settings, member(OTHER_ROLE_ID), CHANNEL_ID), true, "an ignored channel blocks everyone");
  assert.equal(textXpIgnored(settings, member(OTHER_ROLE_ID), OTHER_CHANNEL_ID), false);
});

test("voiceXpIgnored mirrors textXpIgnored against the voice channel list", () => {
  const settings = settingsWith({ ignored_voice_channels: [CHANNEL_ID] });
  assert.equal(voiceXpIgnored(settings, member(), CHANNEL_ID), true);
  assert.equal(voiceXpIgnored(settings, member(), OTHER_CHANNEL_ID), false);
});

test("text and voice multipliers default to 1 and reject negatives or garbage", () => {
  assert.equal(textMultiplier(settingsWith({})), 1);
  assert.equal(textMultiplier(settingsWith({ text_multiplier: 2.5 })), 2.5);
  assert.equal(textMultiplier(settingsWith({ text_multiplier: -1 })), 1);
  assert.equal(voiceMultiplier(settingsWith({ voice_multiplier: "not-a-number" })), 1);
});

test("voiceXpEnabled is opt-in", () => {
  assert.equal(voiceXpEnabled(settingsWith({})), false);
  assert.equal(voiceXpEnabled(settingsWith({ voice_enabled: true })), true);
});

test("voiceXpForSeconds pays VOICE_XP_PER_MINUTE per minute, scaled by the multiplier, never negative", () => {
  assert.equal(voiceXpForSeconds(60, 1), VOICE_XP_PER_MINUTE);
  assert.equal(voiceXpForSeconds(120, 2), VOICE_XP_PER_MINUTE * 4);
  assert.equal(voiceXpForSeconds(-30, 1), 0);
});

test("leaderboardLimit only ever tightens the request, defaulting when the server never set a cap", () => {
  assert.equal(leaderboardLimit(settingsWith({}), 500), Math.min(500, DEFAULT_MAX_MEMBERS));
  assert.equal(leaderboardLimit(settingsWith({ max_members: 200 }), 500), 200);
  assert.equal(leaderboardLimit(settingsWith({ max_members: 200 }), 50), 50, "never loosens below what was requested");
});

test("resetOnLeave and publicPageEnabled are plain opt-in flags", () => {
  assert.equal(resetOnLeave(settingsWith({})), false);
  assert.equal(resetOnLeave(settingsWith({ reset_on_leave: true })), true);
  assert.equal(publicPageEnabled(settingsWith({})), false);
  assert.equal(publicPageEnabled(settingsWith({ public_page: true })), true);
});

test("cardStyle exposes only what the server configured, null otherwise", () => {
  assert.deepEqual(cardStyle(settingsWith({})), { accent: null, background: null });
  assert.deepEqual(cardStyle(settingsWith({ card_accent: "#ffffff", card_background: "https://x/y.png" })), {
    accent: "#ffffff",
    background: "https://x/y.png",
  });
});

/* ------------------------------------------------------------------ RankCard */

function fakeUser(overrides = {}) {
  return {
    username: "isaac",
    discriminator: "0",
    displayAvatarURL: () => "https://cdn.discordapp.com/avatar.png",
    ...overrides,
  };
}

test("buildRankCardUrl carries every stat and omits a legacy-free discriminator", () => {
  const url = new URL(
    buildRankCardUrl({
      user: fakeUser(),
      level: 4,
      xp: 120,
      xpNeeded: 1600,
      rank: 3,
      presenceStatus: "online",
      settings: null,
    })
  );
  assert.equal(url.searchParams.get("name"), "isaac");
  assert.equal(url.searchParams.has("discriminator"), false, "modern usernames have no discriminator to show");
  assert.equal(url.searchParams.get("currentxp"), "120");
  assert.equal(url.searchParams.get("reqxp"), "1600");
  assert.equal(url.searchParams.get("level"), "4");
  assert.equal(url.searchParams.get("rank"), "3");
  assert.equal(url.searchParams.get("status"), "online");
  assert.equal(url.searchParams.get("barcolor"), "#A855F7", "falls back to the bot's own embed color");
  assert.equal(url.searchParams.has("background"), false);
});

test("buildRankCardUrl uses the server's own card accent and background when set", () => {
  const url = new URL(
    buildRankCardUrl({
      user: fakeUser({ discriminator: "1234" }),
      level: 1,
      xp: 0,
      xpNeeded: 100,
      rank: 0,
      settings: settingsWith({ card_accent: "#123456", card_background: "https://example.com/bg.png" }),
    })
  );
  assert.equal(url.searchParams.get("discriminator"), "1234");
  assert.equal(url.searchParams.get("barcolor"), "#123456");
  assert.equal(url.searchParams.get("background"), "https://example.com/bg.png");
  assert.equal(url.searchParams.get("status"), "idle", "a missing presence status defaults to idle");
});

/* -------------------------------------------------------------- DB-backed */

const { getMemberStats, deleteMemberStats, model: memberStatsModel } = require("@schemas/MemberStats");
const { model: guildModel } = require("@schemas/Guild");
const { applyXpGain, trackMessageStats, trackVoiceStats } = require("@src/handlers/stats");
const guildMemberRemove = require("@src/events/member/guildMemberRemove");
const rankingPublicRouter = require("../dashboard/routes/guild/rankingPublic");

let mongo;
let nextId = 800000000000000000n;
function freshId() {
  nextId += 1n;
  return String(nextId);
}

test.before(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
});

test.after(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

async function seedSettings(overrides = {}) {
  const id = freshId();
  await guildModel.create({ _id: id, ...overrides });
  return id;
}

function fakeClient() {
  return {
    logger: { warn: () => {}, error: () => {} },
    config: { STATS: { XP_COOLDOWN: 60, DEFAULT_LVL_UP_MSG: "leveled up to {level}" } },
  };
}

function fakeGuild(id) {
  return {
    id,
    name: "Test Guild",
    memberCount: 10,
    channels: { cache: new Map() },
    systemChannel: null,
    roles: { cache: new Map() },
  };
}

function fakeMember({ guild, id = freshId(), roleIds = [], bot = false }) {
  return {
    id,
    displayName: "Tester",
    toString: () => `<@${id}>`,
    user: { bot, username: "tester", globalName: null },
    guild,
    client: fakeClient(),
    roles: { cache: { has: (roleId) => roleIds.includes(roleId) } },
  };
}

/**
 * A voice session's earned time depends on real elapsed wall-clock seconds
 * between the join and leave calls - overriding Date.now directly (restored
 * in `finally`) is simpler and less flake-prone under this suite's
 * many-files test run than node:test's own mock timers.
 */
async function withAdvancingClock(fn) {
  const original = Date.now;
  let current = original();
  Date.now = () => current;
  try {
    return await fn({ advance: (ms) => (current += ms) });
  } finally {
    Date.now = original;
  }
}

/* ------------------------------------------------------------- applyXpGain */

test("applyXpGain levels a member up as many times as it takes, and applies level rewards once", async () => {
  const guildId = freshId();
  const guild = fakeGuild(guildId);
  guild.roles.cache.set(ROLE_ID, { id: ROLE_ID, managed: false, editable: true });
  const roleCalls = [];
  const testMember = fakeMember({ guild });
  testMember.roles.add = async (ids) => roleCalls.push(["add", ids]);
  testMember.roles.remove = async (ids) => roleCalls.push(["remove", ids]);

  const statsDb = await getMemberStats(guildId, testMember.id);
  const settings = {
    stats: {
      xp: { level_multiplier: 100 },
      rewards: { level: [{ threshold: 2, add_roles: [ROLE_ID], remove_roles: [] }] },
    },
  };

  // level 1 needs 1*1*100 = 100, level 2 needs 2*2*100 = 400 - 150 crosses only the first.
  await applyXpGain(statsDb, 150, testMember, settings, null);

  assert.equal(statsDb.level, 2);
  assert.equal(statsDb.xp, 50);
  assert.deepEqual(roleCalls, [["add", [ROLE_ID]]]);

  const persisted = await memberStatsModel.findOne({ guild_id: guildId, member_id: testMember.id });
  assert.equal(persisted.level, 2, "the level-up was actually saved");
});

test("applyXpGain announces a level-up in the given fallback channel, not the system channel", async () => {
  const guildId = freshId();
  const guild = fakeGuild(guildId);
  const testMember = fakeMember({ guild });
  const statsDb = await getMemberStats(guildId, testMember.id);

  const fallbackSent = [];
  const systemSent = [];
  guild.systemChannel = { safeSend: (msg) => systemSent.push(msg) };
  const fallbackChannel = { safeSend: (msg) => fallbackSent.push(msg) };

  await applyXpGain(statsDb, 150, testMember, { stats: { xp: { level_multiplier: 100 } } }, fallbackChannel);

  assert.equal(fallbackSent.length, 1, "the invoking channel gets the announcement");
  assert.equal(systemSent.length, 0, "the system channel is not touched once a fallback was given");
});

test("applyXpGain falls back to the guild's system channel when no channel was given at all", async () => {
  const guildId = freshId();
  const guild = fakeGuild(guildId);
  const testMember = fakeMember({ guild });
  const statsDb = await getMemberStats(guildId, testMember.id);

  const systemSent = [];
  guild.systemChannel = { safeSend: (msg) => systemSent.push(msg) };

  await applyXpGain(statsDb, 150, testMember, { stats: { xp: { level_multiplier: 100 } } });

  assert.equal(systemSent.length, 1, "voice sessions have no invoking channel, so this is their only fallback");
});

test("applyXpGain with zero or negative XP only saves, granting nothing", async () => {
  const guildId = freshId();
  const guild = fakeGuild(guildId);
  const testMember = fakeMember({ guild });
  const statsDb = await getMemberStats(guildId, testMember.id);
  statsDb.messages = 3;

  await applyXpGain(statsDb, 0, testMember, {});

  assert.equal(statsDb.xp, 0);
  assert.equal(statsDb.level, 1);
  const persisted = await memberStatsModel.findOne({ guild_id: guildId, member_id: testMember.id });
  assert.equal(persisted.messages, 3, "the save still happens even when no XP was granted");
});

/* -------------------------------------------------------- trackMessageStats */

test("trackMessageStats grants nothing to an ignored member, but still counts the message", async () => {
  const guildId = freshId();
  const guild = fakeGuild(guildId);
  const testMember = fakeMember({ guild, roleIds: [ROLE_ID] });
  const message = {
    guildId,
    channelId: freshId(),
    id: freshId(),
    createdAt: new Date(),
    member: testMember,
    channel: { safeSend: () => {} },
    client: fakeClient(),
  };
  const settings = {
    control_center: { ranking: { ignored_roles: [ROLE_ID] } },
    stats: { xp: { min_per_message: 10, max_per_message: 10 } },
  };

  await trackMessageStats(message, false, settings);

  const stats = await memberStatsModel.findOne({ guild_id: guildId, member_id: testMember.id });
  assert.equal(stats.xp, 0);
  assert.equal(stats.messages, 1);
});

test("trackMessageStats scales the earned XP by the server's own text multiplier", async () => {
  const guildId = freshId();
  const guild = fakeGuild(guildId);
  const testMember = fakeMember({ guild });
  const message = {
    guildId,
    channelId: freshId(),
    id: freshId(),
    createdAt: new Date(),
    member: testMember,
    channel: { safeSend: () => {} },
    client: fakeClient(),
  };
  const settings = {
    control_center: { ranking: { text_multiplier: 2 } },
    stats: { xp: { min_per_message: 10, max_per_message: 10 } },
  };

  await trackMessageStats(message, false, settings);

  const stats = await memberStatsModel.findOne({ guild_id: guildId, member_id: testMember.id });
  assert.equal(stats.xp, 20);
});

/* ---------------------------------------------------------- trackVoiceStats */

test("a voice session grants XP on disconnect when enabled, alongside the separate time-threshold role reward", async () => {
  const guildId = freshId();
  const guild = fakeGuild(guildId);
  guild.roles.cache.set(ROLE_ID, { id: ROLE_ID, managed: false, editable: true });
  const roleCalls = [];
  const testMember = fakeMember({ guild });
  testMember.roles.add = async (ids) => roleCalls.push(["add", ids]);
  testMember.roles.remove = async (ids) => roleCalls.push(["remove", ids]);

  const voiceChannelId = freshId();
  const settings = {
    control_center: { ranking: { voice_enabled: true } },
    stats: { rewards: { voice: [{ threshold: 60, add_roles: [ROLE_ID], remove_roles: [] }] } },
  };

  await withAdvancingClock(async ({ advance }) => {
    await trackVoiceStats(
      { channel: null, member: null },
      { channel: { id: voiceChannelId }, member: { fetch: async () => testMember } },
      settings
    );
    advance(120_000);
    await trackVoiceStats(
      { channel: { id: voiceChannelId }, member: { fetch: async () => testMember } },
      { channel: null, member: { fetch: async () => testMember } },
      settings
    );
  });

  const stats = await memberStatsModel.findOne({ guild_id: guildId, member_id: testMember.id });
  assert.equal(Math.round(stats.voice.time), 120);
  assert.equal(stats.xp, VOICE_XP_PER_MINUTE * 2);
  assert.deepEqual(roleCalls, [["add", [ROLE_ID]]], "the voice-time threshold reward still fires independently");
});

test("voice XP being off does not stop the older voice-time role reward from firing", async () => {
  const guildId = freshId();
  const guild = fakeGuild(guildId);
  guild.roles.cache.set(ROLE_ID, { id: ROLE_ID, managed: false, editable: true });
  const roleCalls = [];
  const testMember = fakeMember({ guild });
  testMember.roles.add = async (ids) => roleCalls.push(["add", ids]);
  testMember.roles.remove = async (ids) => roleCalls.push(["remove", ids]);

  const voiceChannelId = freshId();
  const settings = {
    // voice_enabled left unset, i.e. off
    stats: { rewards: { voice: [{ threshold: 60, add_roles: [ROLE_ID], remove_roles: [] }] } },
  };

  await withAdvancingClock(async ({ advance }) => {
    await trackVoiceStats(
      { channel: null, member: null },
      { channel: { id: voiceChannelId }, member: { fetch: async () => testMember } },
      settings
    );
    advance(120_000);
    await trackVoiceStats(
      { channel: { id: voiceChannelId }, member: { fetch: async () => testMember } },
      { channel: null, member: { fetch: async () => testMember } },
      settings
    );
  });

  const stats = await memberStatsModel.findOne({ guild_id: guildId, member_id: testMember.id });
  assert.equal(stats.xp, 0, "no XP was ever offered");
  assert.equal(Math.round(stats.voice.time), 120, "time tracking is unrelated to XP and keeps working");
  assert.deepEqual(roleCalls, [["add", [ROLE_ID]]], "the time-threshold reward is a separate system");
});

test("an ignored voice channel earns no XP even with voice XP enabled server-wide", async () => {
  const guildId = freshId();
  const guild = fakeGuild(guildId);
  const testMember = fakeMember({ guild });
  const voiceChannelId = freshId();
  const settings = {
    control_center: { ranking: { voice_enabled: true, ignored_voice_channels: [voiceChannelId] } },
  };

  await withAdvancingClock(async ({ advance }) => {
    await trackVoiceStats(
      { channel: null, member: null },
      { channel: { id: voiceChannelId }, member: { fetch: async () => testMember } },
      settings
    );
    advance(120_000);
    await trackVoiceStats(
      { channel: { id: voiceChannelId }, member: { fetch: async () => testMember } },
      { channel: null, member: { fetch: async () => testMember } },
      settings
    );
  });

  const stats = await memberStatsModel.findOne({ guild_id: guildId, member_id: testMember.id });
  assert.equal(stats.xp, 0);
});

/* ------------------------------------------------------------ MemberStats */

test("deleteMemberStats evicts the cache too, so a later .save() cannot resurrect what was deleted", async () => {
  const guildId = freshId();
  const memberId = freshId();

  const stats = await getMemberStats(guildId, memberId);
  stats.xp = 999;
  await stats.save();

  await deleteMemberStats(guildId, memberId);

  const after = await getMemberStats(guildId, memberId);
  assert.equal(after.xp, 0, "a fresh, empty document was created instead of reusing the stale cached one");
  assert.equal(after.isNew, true);

  const raw = await memberStatsModel.findOne({ guild_id: guildId, member_id: memberId });
  assert.equal(raw, null);
});

/* -------------------------------------------------------- guildMemberRemove */

test("reset-on-leave clears ranking progress on a real leave event, and never touches it when off", async () => {
  async function scenario(resetOnLeaveEnabled) {
    const guildId = await seedSettings({ control_center: { ranking: { reset_on_leave: resetOnLeaveEnabled } } });
    const memberId = freshId();

    const stats = await getMemberStats(guildId, memberId);
    stats.xp = 500;
    stats.level = 3;
    await stats.save();

    const client = fakeClient();
    const leavingMember = {
      id: memberId,
      partial: false,
      user: { bot: false },
      guild: fakeGuild(guildId),
      client,
    };

    await guildMemberRemove(client, leavingMember);

    return memberStatsModel.findOne({ guild_id: guildId, member_id: memberId });
  }

  assert.equal(await scenario(true), null, "reset-on-leave clears the member's ranking progress");
  assert.notEqual(await scenario(false), null, "without it, progress survives a leave");
});

/* --------------------------------------------------------- public leaderboard */

function fakeDiscordGuild(id, name, memberNames = {}) {
  return {
    id,
    name,
    iconURL: () => null,
    members: {
      cache: {
        get: (memberId) =>
          memberNames[memberId]
            ? {
                displayName: memberNames[memberId],
                user: { username: memberNames[memberId] },
                displayAvatarURL: () => null,
              }
            : undefined,
      },
    },
  };
}

function fakeRouteRes() {
  return {
    statusCode: 200,
    rendered: null,
    locals: { t: (key) => key },
    status(code) {
      this.statusCode = code;
      return this;
    },
    render(view, locals) {
      this.rendered = { view, locals };
      return this;
    },
  };
}

function routeHandler(router, method, path) {
  const layer = router.stack.find((entry) => entry.route?.path === path && entry.route.methods[method]);
  return layer.route.stack[0].handle;
}

const publicRankingHandler = routeHandler(rankingPublicRouter, "get", "/");

test("the public leaderboard 404s for a guild the bot cannot see", async () => {
  const req = { params: { guildId: freshId() }, client: { guilds: { cache: new Map() } } };
  const res = fakeRouteRes();

  await publicRankingHandler(req, res);

  assert.equal(res.statusCode, 404);
  assert.equal(res.rendered.view, "error");
});

test("the public leaderboard 404s unless both stats and the public page itself are turned on", async () => {
  const statsOffId = await seedSettings({
    stats: { enabled: false },
    control_center: { ranking: { public_page: true } },
  });
  const resStatsOff = fakeRouteRes();
  await publicRankingHandler(
    {
      params: { guildId: statsOffId },
      client: { guilds: { cache: new Map([[statsOffId, fakeDiscordGuild(statsOffId, "A")]]) } },
    },
    resStatsOff
  );
  assert.equal(resStatsOff.statusCode, 404);

  const pageOffId = await seedSettings({
    stats: { enabled: true },
    control_center: { ranking: { public_page: false } },
  });
  const resPageOff = fakeRouteRes();
  await publicRankingHandler(
    {
      params: { guildId: pageOffId },
      client: { guilds: { cache: new Map([[pageOffId, fakeDiscordGuild(pageOffId, "B")]]) } },
    },
    resPageOff
  );
  assert.equal(resPageOff.statusCode, 404);
});

test("an enabled public leaderboard renders ranked members with a display-name fallback to the raw id", async () => {
  const guildId = await seedSettings({ stats: { enabled: true }, control_center: { ranking: { public_page: true } } });
  const memberA = freshId();
  const memberB = freshId();
  await memberStatsModel.create({ guild_id: guildId, member_id: memberA, level: 5, xp: 40 });
  await memberStatsModel.create({ guild_id: guildId, member_id: memberB, level: 3, xp: 10 });

  const discordGuild = fakeDiscordGuild(guildId, "Test Guild", { [memberA]: "Alice" });
  const req = { params: { guildId }, client: { guilds: { cache: new Map([[guildId, discordGuild]]) } } };
  const res = fakeRouteRes();

  await publicRankingHandler(req, res);

  assert.equal(res.rendered.view, "guild/rankingPublic");
  const { leaderboard } = res.rendered.locals;
  assert.equal(leaderboard.length, 2);
  assert.equal(leaderboard[0].rank, 1);
  assert.equal(leaderboard[0].name, "Alice", "a cached member uses their display name");
  assert.equal(leaderboard[1].name, memberB, "an uncached member falls back to the raw id");
});
