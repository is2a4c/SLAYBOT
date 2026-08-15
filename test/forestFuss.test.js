const test = require("node:test");
const assert = require("node:assert/strict");
require("module-alias/register");

const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const { assignRoles, canControl, checkWin, tally, wolfCount } = require("@src/services/forestFuss/engine");
const {
  MIN_PLAYERS,
  categoryId,
  forestFussEnabled,
  leadersOnly,
  lobbyName,
  maxPlayers,
  maxSessions,
  phaseSeconds,
  wolvesName,
} = require("@src/services/forestFuss/policy");

const ROLE_ID = "100000000000000001";

function settingsWith(fun) {
  return { control_center: { fun } };
}

/* ------------------------------------------------------------------ engine */

test("wolfCount is about a quarter of the table, never fewer than one", () => {
  assert.equal(wolfCount(4), 1);
  assert.equal(wolfCount(7), 1);
  assert.equal(wolfCount(8), 2);
  assert.equal(wolfCount(20), 5);
  assert.equal(wolfCount(1), 1);
});

test("assignRoles gives every input id exactly one role, in the right proportion", () => {
  const ids = ["a", "b", "c", "d", "e", "f", "g", "h"];
  const assigned = assignRoles(ids);

  assert.deepEqual(new Set(assigned.map((player) => player.user_id)), new Set(ids));
  assert.equal(assigned.filter((player) => player.role === "WOLF").length, wolfCount(ids.length));
  assert.equal(assigned.filter((player) => player.role === "VILLAGER").length, ids.length - wolfCount(ids.length));
  assert.ok(assigned.every((player) => player.alive === true));
});

test("assignRoles is deterministic under an injected rng", () => {
  const ids = ["a", "b", "c", "d"];
  const first = assignRoles(ids, () => 0.1);
  const second = assignRoles(ids, () => 0.1);
  assert.deepEqual(first, second);
});

test("tally elects the target with the most votes among the alive", () => {
  const alive = new Set(["a", "b", "c"]);
  const votes = [
    { voter_id: "a", target_id: "b" },
    { voter_id: "b", target_id: "b" },
    { voter_id: "c", target_id: "a" },
  ];
  assert.equal(tally(votes, alive), "b");
});

test("tally elects nobody on a tie or on no votes at all", () => {
  const alive = new Set(["a", "b", "c", "d"]);
  const tied = [
    { voter_id: "a", target_id: "b" },
    { voter_id: "c", target_id: "d" },
  ];
  assert.equal(tally(tied, alive), null);
  assert.equal(tally([], alive), null);
});

test("tally ignores votes for someone no longer alive", () => {
  const alive = new Set(["a", "b"]);
  const votes = [
    { voter_id: "a", target_id: "dead" },
    { voter_id: "b", target_id: "a" },
  ];
  assert.equal(tally(votes, alive), "a");
});

test("checkWin: no wolves left means the villagers win", () => {
  const players = [
    { role: "WOLF", alive: false },
    { role: "VILLAGER", alive: true },
    { role: "VILLAGER", alive: true },
  ];
  assert.equal(checkWin(players), "VILLAGERS");
});

test("checkWin: wolves at parity or ahead means the wolves win", () => {
  const parity = [
    { role: "WOLF", alive: true },
    { role: "VILLAGER", alive: true },
  ];
  assert.equal(checkWin(parity), "WOLVES");

  const ahead = [
    { role: "WOLF", alive: true },
    { role: "WOLF", alive: true },
    { role: "VILLAGER", alive: true },
  ];
  assert.equal(checkWin(ahead), "WOLVES");
});

test("checkWin returns null while both sides still have the numbers", () => {
  const players = [
    { role: "WOLF", alive: true },
    { role: "VILLAGER", alive: true },
    { role: "VILLAGER", alive: true },
  ];
  assert.equal(checkWin(players), null);
});

test("canControl always lets the leader through", () => {
  const session = { leader_id: "leader", players: [{ user_id: "leader", alive: true }] };
  assert.equal(canControl(session, "leader", true), true);
  assert.equal(canControl(session, "leader", false), true);
});

test("canControl with leaders-only blocks everyone else, alive or not", () => {
  const session = {
    leader_id: "leader",
    players: [
      { user_id: "leader", alive: true },
      { user_id: "player", alive: true },
    ],
  };
  assert.equal(canControl(session, "player", true), false);
});

test("canControl without leaders-only lets any alive player through, but not a dead one or a bystander", () => {
  const session = {
    leader_id: "leader",
    players: [
      { user_id: "leader", alive: true },
      { user_id: "alive-player", alive: true },
      { user_id: "dead-player", alive: false },
    ],
  };
  assert.equal(canControl(session, "alive-player", false), true);
  assert.equal(canControl(session, "dead-player", false), false);
  assert.equal(canControl(session, "bystander", false), false);
});

/* ------------------------------------------------------------------ policy */

test("forestFussEnabled defaults to off", () => {
  assert.equal(forestFussEnabled(null), false);
  assert.equal(forestFussEnabled(settingsWith({})), false);
  assert.equal(forestFussEnabled(settingsWith({ forest_fuss_enabled: true })), true);
});

test("categoryId is null unless the server configured one", () => {
  assert.equal(categoryId(settingsWith({})), null);
  assert.equal(categoryId(settingsWith({ category_id: ROLE_ID })), ROLE_ID);
});

test("maxSessions and maxPlayers fall back to sane defaults on garbage input", () => {
  assert.equal(maxSessions(settingsWith({})), 1);
  assert.equal(maxSessions(settingsWith({ max_sessions: 5 })), 5);
  assert.equal(maxSessions(settingsWith({ max_sessions: -1 })), 1);
  assert.equal(maxSessions(settingsWith({ max_sessions: "nope" })), 1);

  assert.equal(maxPlayers(settingsWith({})), 20);
  assert.equal(maxPlayers(settingsWith({ max_players: 10 })), 10);
  assert.equal(
    maxPlayers(settingsWith({ max_players: 1 })),
    20,
    "below the schema's own floor falls back to the default"
  );
});

test("lobbyName and wolvesName fall back to their defaults", () => {
  assert.equal(lobbyName(settingsWith({})), "forest-lobby");
  assert.equal(lobbyName(settingsWith({ lobby_name: "camp" })), "camp");
  assert.equal(wolvesName(settingsWith({})), "wolves");
  assert.equal(wolvesName(settingsWith({ wolves_name: "den" })), "den");
});

test("leadersOnly defaults to on, matching the schema default", () => {
  assert.equal(leadersOnly(settingsWith({})), true);
  assert.equal(leadersOnly(settingsWith({ leaders_only: false })), false);
  assert.equal(leadersOnly(settingsWith({ leaders_only: true })), true);
});

test("phaseSeconds has its own default per phase and accepts an override", () => {
  assert.equal(phaseSeconds(settingsWith({}), "recruitment"), 120);
  assert.equal(phaseSeconds(settingsWith({}), "day"), 180);
  assert.equal(phaseSeconds(settingsWith({}), "night"), 120);
  assert.equal(phaseSeconds(settingsWith({}), "result"), 30);
  assert.equal(phaseSeconds(settingsWith({ day_seconds: 60 }), "day"), 60);
});

test("MIN_PLAYERS matches the schema's own floor for max_players", () => {
  assert.equal(MIN_PLAYERS, 4);
});

/* -------------------------------------------------------------- DB-backed */

const {
  claimPhaseTransition,
  countActiveSessions,
  createSession,
  deleteGuildSessions,
  deleteSession,
  findSessionForMember,
  getSession,
} = require("@schemas/ForestFussSession");
const { model: guildModel } = require("@schemas/Guild");
const {
  PREFIX_JOIN,
  PREFIX_LEAVE,
  PREFIX_SKIP,
  PREFIX_STOP,
  PREFIX_VOTE,
  advancePhase,
  handleJoin,
  handleLeave,
  handleSkip,
  handleStop,
  handleVote,
  startSession,
} = require("@src/services/forestFuss/game");

let mongo;
let nextId = 900000000000000000n;
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

/* ---------------------------------------------------------- schema layer */

test("createSession seeds the leader as the first player", async () => {
  const lobbyId = freshId();
  const guildId = freshId();
  const leaderId = freshId();

  const session = await createSession({ lobbyChannelId: lobbyId, guildId, leaderId });
  assert.equal(session._id, lobbyId);
  assert.equal(session.phase, "RECRUITMENT");
  assert.deepEqual(
    session.players.map((player) => player.user_id),
    [leaderId]
  );
});

test("countActiveSessions and findSessionForMember are scoped per guild", async () => {
  const guildId = freshId();
  const otherGuildId = freshId();
  const leaderId = freshId();
  const memberId = freshId();

  const lobbyId = freshId();
  await createSession({ lobbyChannelId: lobbyId, guildId, leaderId });
  await (await getSession(lobbyId)).updateOne({ $push: { players: { user_id: memberId } } });

  await createSession({ lobbyChannelId: freshId(), guildId: otherGuildId, leaderId: freshId() });

  assert.equal(await countActiveSessions(guildId), 1);
  assert.equal(await countActiveSessions(otherGuildId), 1);
  assert.equal(await countActiveSessions(freshId()), 0);

  const found = await findSessionForMember(guildId, memberId);
  assert.equal(found._id, lobbyId);
  assert.equal(await findSessionForMember(otherGuildId, memberId), null);
});

test("claimPhaseTransition only succeeds when the phase still matches, so a race backs off", async () => {
  const lobbyId = freshId();
  await createSession({ lobbyChannelId: lobbyId, guildId: freshId(), leaderId: freshId() });

  const claimed = await claimPhaseTransition(lobbyId, "RECRUITMENT");
  assert.ok(claimed);
  assert.equal(claimed.phase, "TRANSITIONING");

  const raced = await claimPhaseTransition(lobbyId, "RECRUITMENT");
  assert.equal(raced, null, "the phase already moved on, so a second claim for the same origin fails");
});

test("deleteSession and deleteGuildSessions remove what they say", async () => {
  const guildId = freshId();
  const lobbyA = freshId();
  const lobbyB = freshId();
  await createSession({ lobbyChannelId: lobbyA, guildId, leaderId: freshId() });
  await createSession({ lobbyChannelId: lobbyB, guildId, leaderId: freshId() });

  await deleteSession(lobbyA);
  assert.equal(await getSession(lobbyA), null);
  assert.ok(await getSession(lobbyB));

  await deleteGuildSessions(guildId);
  assert.equal(await getSession(lobbyB), null);
});

/* ------------------------------------------------------------- fake Discord */

function fakeChannel({ id, name, type, parentId, guild }) {
  const messages = new Map();
  let counter = 0;
  const channel = {
    id,
    name,
    type,
    parentId: parentId || null,
    guild,
    permissionOverwrites: { edit: async () => {} },
    async send(payload) {
      counter += 1;
      const messageId = `${id}-msg-${counter}`;
      const message = {
        id: messageId,
        payload,
        async edit(next) {
          message.payload = next;
          return message;
        },
      };
      messages.set(messageId, message);
      return message;
    },
    messages: { fetch: async (messageId) => messages.get(messageId) || null },
    async delete() {
      guild._channels.delete(id);
    },
    _messages: messages,
  };
  return channel;
}

function fakeGuild({ id, name = "Test Guild" }) {
  const channels = new Map();
  const members = new Map();

  const guild = {
    id,
    name,
    ownerId: freshId(),
    _channels: channels,
    _members: members,
    roles: { everyone: { id: `${id}-everyone` } },
    members: {
      me: { id: "bot-1", permissions: { has: () => true } },
      cache: { get: (userId) => members.get(userId) },
      fetch: async (userId) => members.get(userId) || null,
    },
    channels: {
      cache: { get: (channelId) => channels.get(channelId) },
      fetch: async (channelId) => channels.get(channelId) || null,
      create: async (options) => {
        const channelId = `chan-${channels.size + 1}-${id}`;
        const channel = fakeChannel({
          id: channelId,
          name: options.name,
          type: options.type,
          parentId: options.parent,
          guild,
        });
        channels.set(channelId, channel);
        return channel;
      },
    },
  };

  return guild;
}

function addMember(guild, userId, overrides = {}) {
  const dms = [];
  guild._members.set(userId, {
    id: userId,
    displayName: overrides.displayName || `Player-${userId.slice(-4)}`,
    user: { username: overrides.username || userId, bot: false },
    async send(content) {
      dms.push(content);
      return {};
    },
    dms,
  });
}

function fakeClient(guild) {
  return {
    guilds: { fetch: async (guildId) => (guildId === guild.id ? guild : null) },
    channels: { fetch: async (channelId) => guild._channels.get(channelId) || null },
    scheduler: { schedule: async () => {}, cancel: async () => {} },
  };
}

function fakeInteraction({ prefix, lobbyId, guild, client, userId, values }) {
  const replies = [];
  return {
    customId: `${prefix}:${lobbyId}`,
    user: { id: userId },
    guildId: guild.id,
    guild,
    client,
    channel: guild._channels.get(lobbyId) || null,
    values: values || [],
    replies,
    async reply(payload) {
      replies.push(payload);
      return {};
    },
    async deferUpdate() {
      return {};
    },
  };
}

async function seedGuildSettings(guildId, fun = {}) {
  await guildModel.create({ _id: guildId, control_center: { fun } });
}

/* ------------------------------------------------------------ startSession */

test("startSession refuses when Forest Fuss is turned off", async () => {
  const guild = fakeGuild({ id: freshId() });
  const client = fakeClient(guild);
  const leader = { id: freshId() };

  const result = await startSession({ client, guild, leader, settings: settingsWith({}) });
  assert.equal(result.ok, false);
});

test("startSession refuses without Manage Channels", async () => {
  const guild = fakeGuild({ id: freshId() });
  guild.members.me.permissions.has = () => false;
  const client = fakeClient(guild);

  const result = await startSession({
    client,
    guild,
    leader: { id: freshId() },
    settings: settingsWith({ forest_fuss_enabled: true }),
  });
  assert.equal(result.ok, false);
});

test("startSession refuses a leader who is already in another session", async () => {
  const guildId = freshId();
  const guild = fakeGuild({ id: guildId });
  const client = fakeClient(guild);
  const leaderId = freshId();

  await createSession({ lobbyChannelId: freshId(), guildId, leaderId });

  const result = await startSession({
    client,
    guild,
    leader: { id: leaderId },
    settings: settingsWith({ forest_fuss_enabled: true }),
  });
  assert.equal(result.ok, false);
});

test("startSession refuses once the server's concurrent-session cap is reached", async () => {
  const guildId = freshId();
  const guild = fakeGuild({ id: guildId });
  const client = fakeClient(guild);

  await createSession({ lobbyChannelId: freshId(), guildId, leaderId: freshId() });

  const result = await startSession({
    client,
    guild,
    leader: { id: freshId() },
    settings: settingsWith({ forest_fuss_enabled: true, max_sessions: 1 }),
  });
  assert.equal(result.ok, false);
});

test("startSession refuses a configured category that no longer exists", async () => {
  const guild = fakeGuild({ id: freshId() });
  const client = fakeClient(guild);

  const result = await startSession({
    client,
    guild,
    leader: { id: freshId() },
    settings: settingsWith({ forest_fuss_enabled: true, category_id: "missing-category" }),
  });
  assert.equal(result.ok, false);
});

test("startSession creates a lobby channel and a recruiting session", async () => {
  const guild = fakeGuild({ id: freshId() });
  const client = fakeClient(guild);
  const leaderId = freshId();
  addMember(guild, leaderId);

  const result = await startSession({
    client,
    guild,
    leader: { id: leaderId },
    settings: settingsWith({ forest_fuss_enabled: true }),
  });
  assert.equal(result.ok, true);
  assert.ok(result.channel);

  const session = await getSession(result.channel.id);
  assert.equal(session.phase, "RECRUITMENT");
  assert.equal(session.leader_id, leaderId);
  assert.deepEqual(
    session.players.map((player) => player.user_id),
    [leaderId]
  );
  assert.ok(result.channel._messages.size >= 1, "the lobby panel was posted");
});

/* ---------------------------------------------------------- join and leave */

test("handleJoin adds a player, and refuses a duplicate, a full lobby, or the wrong phase", async () => {
  const guild = fakeGuild({ id: freshId() });
  const client = fakeClient(guild);
  const leaderId = freshId();
  addMember(guild, leaderId);
  const settings = settingsWith({ forest_fuss_enabled: true, max_players: 4 });

  const { channel } = await startSession({ client, guild, leader: { id: leaderId }, settings });
  const lobbyId = channel.id;

  const playerA = freshId();
  addMember(guild, playerA);
  await handleJoin(fakeInteraction({ prefix: PREFIX_JOIN, lobbyId, guild, client, userId: playerA }), settings);

  let session = await getSession(lobbyId);
  assert.equal(session.players.length, 2);

  // duplicate join
  const dup = fakeInteraction({ prefix: PREFIX_JOIN, lobbyId, guild, client, userId: playerA });
  await handleJoin(dup, settings);
  assert.equal(dup.replies.length, 1);

  // fill the lobby to its cap of 4, then the next join is refused
  const playerB = freshId();
  const playerC = freshId();
  addMember(guild, playerB);
  addMember(guild, playerC);
  await handleJoin(fakeInteraction({ prefix: PREFIX_JOIN, lobbyId, guild, client, userId: playerB }), settings);
  await handleJoin(fakeInteraction({ prefix: PREFIX_JOIN, lobbyId, guild, client, userId: playerC }), settings);

  const overflow = freshId();
  addMember(guild, overflow);
  const overflowInteraction = fakeInteraction({ prefix: PREFIX_JOIN, lobbyId, guild, client, userId: overflow });
  await handleJoin(overflowInteraction, settings);
  assert.equal(overflowInteraction.replies.length, 1, "the lobby is full");

  session = await getSession(lobbyId);
  assert.equal(session.players.length, 4);
});

test("handleLeave removes a joined player but refuses the leader and a non-member", async () => {
  const guild = fakeGuild({ id: freshId() });
  const client = fakeClient(guild);
  const leaderId = freshId();
  addMember(guild, leaderId);
  const settings = settingsWith({ forest_fuss_enabled: true });

  const { channel } = await startSession({ client, guild, leader: { id: leaderId }, settings });
  const lobbyId = channel.id;

  const playerA = freshId();
  addMember(guild, playerA);
  await handleJoin(fakeInteraction({ prefix: PREFIX_JOIN, lobbyId, guild, client, userId: playerA }), settings);

  await handleLeave(fakeInteraction({ prefix: PREFIX_LEAVE, lobbyId, guild, client, userId: playerA }), settings);
  let session = await getSession(lobbyId);
  assert.deepEqual(
    session.players.map((player) => player.user_id),
    [leaderId]
  );

  const leaderLeaves = fakeInteraction({ prefix: PREFIX_LEAVE, lobbyId, guild, client, userId: leaderId });
  await handleLeave(leaderLeaves, settings);
  assert.equal(leaderLeaves.replies.length, 1);

  const stranger = fakeInteraction({ prefix: PREFIX_LEAVE, lobbyId, guild, client, userId: freshId() });
  await handleLeave(stranger, settings);
  assert.equal(stranger.replies.length, 1);
});

/* --------------------------------------------------------- skip and stop */

test("handleSkip is leader-only by default and refuses to start with too few players", async () => {
  const guild = fakeGuild({ id: freshId() });
  const client = fakeClient(guild);
  const leaderId = freshId();
  addMember(guild, leaderId);
  const settings = settingsWith({ forest_fuss_enabled: true });

  const { channel } = await startSession({ client, guild, leader: { id: leaderId }, settings });
  const lobbyId = channel.id;

  const stranger = fakeInteraction({ prefix: PREFIX_SKIP, lobbyId, guild, client, userId: freshId() });
  await handleSkip(stranger, settings);
  assert.equal(stranger.replies.length, 1, "a non-leader cannot skip when leaders-only is on");

  const tooFew = fakeInteraction({ prefix: PREFIX_SKIP, lobbyId, guild, client, userId: leaderId });
  await handleSkip(tooFew, settings);
  assert.equal(tooFew.replies.length, 1, "four players are required before the recruitment phase can end");

  const session = await getSession(lobbyId);
  assert.equal(session.phase, "RECRUITMENT", "nothing advanced");
});

test("handleStop ends the game immediately and cleans up the lobby channel", async () => {
  const guild = fakeGuild({ id: freshId() });
  const client = fakeClient(guild);
  const leaderId = freshId();
  addMember(guild, leaderId);
  const settings = settingsWith({ forest_fuss_enabled: true });

  const { channel } = await startSession({ client, guild, leader: { id: leaderId }, settings });
  const lobbyId = channel.id;

  await handleStop(fakeInteraction({ prefix: PREFIX_STOP, lobbyId, guild, client, userId: leaderId }), settings);

  assert.equal(await getSession(lobbyId), null);
  assert.equal(guild._channels.get(lobbyId), undefined);
});

/* ------------------------------------------------------------- full game */

test("a full round: recruitment fills, day removes the wolf outright, villagers win and everything is cleaned up", async () => {
  const guildId = freshId();
  const guild = fakeGuild({ id: guildId });
  const client = fakeClient(guild);
  await seedGuildSettings(guildId, { forest_fuss_enabled: true });

  const leaderId = freshId();
  addMember(guild, leaderId);
  const settings = settingsWith({ forest_fuss_enabled: true });
  const { channel } = await startSession({ client, guild, leader: { id: leaderId }, settings });
  const lobbyId = channel.id;

  const others = [freshId(), freshId(), freshId()];
  for (const userId of others) {
    addMember(guild, userId);
    await handleJoin(fakeInteraction({ prefix: PREFIX_JOIN, lobbyId, guild, client, userId }), settings);
  }

  // Recruitment -> Day: the leader forces it, exactly like the timer would.
  await handleSkip(fakeInteraction({ prefix: PREFIX_SKIP, lobbyId, guild, client, userId: leaderId }), settings);

  let session = await getSession(lobbyId);
  assert.equal(session.phase, "DAY");
  assert.equal(session.round, 1);
  assert.equal(session.players.filter((player) => player.role === "WOLF").length, 1);
  assert.ok(session.wolves_channel_id, "a wolves channel was created");

  const wolf = session.players.find((player) => player.role === "WOLF");
  const everyone = session.players.map((player) => player.user_id);

  // Every alive player votes the wolf out - the last vote triggers the
  // auto-advance path, without waiting for the scheduled deadline.
  for (const voterId of everyone) {
    await handleVote(
      fakeInteraction({ prefix: PREFIX_VOTE, lobbyId, guild, client, userId: voterId, values: [wolf.user_id] }),
      settings
    );
  }

  session = await getSession(lobbyId);
  assert.equal(session.phase, "RESULT");
  assert.equal(session.winner, "VILLAGERS");

  // The result screen stands until its own timer - or a skip - closes it out.
  await handleSkip(fakeInteraction({ prefix: PREFIX_SKIP, lobbyId, guild, client, userId: leaderId }), settings);
  assert.equal(await getSession(lobbyId), null, "closing the result screen cleans up the lobby and wolves channels");
  assert.equal(guild._channels.get(lobbyId), undefined);
});

test("a full round: the villagers misvote, the wolf strikes back at night, and the wolves win", async () => {
  const guildId = freshId();
  const guild = fakeGuild({ id: guildId });
  const client = fakeClient(guild);
  await seedGuildSettings(guildId, { forest_fuss_enabled: true });

  const leaderId = freshId();
  addMember(guild, leaderId);
  const settings = settingsWith({ forest_fuss_enabled: true });
  const { channel } = await startSession({ client, guild, leader: { id: leaderId }, settings });
  const lobbyId = channel.id;

  const others = [freshId(), freshId(), freshId()];
  for (const userId of others) {
    addMember(guild, userId);
    await handleJoin(fakeInteraction({ prefix: PREFIX_JOIN, lobbyId, guild, client, userId }), settings);
  }

  await handleSkip(fakeInteraction({ prefix: PREFIX_SKIP, lobbyId, guild, client, userId: leaderId }), settings);

  let session = await getSession(lobbyId);
  const wolf = session.players.find((player) => player.role === "WOLF");
  const villagers = session.players.filter((player) => player.role === "VILLAGER");
  const everyone = session.players.map((player) => player.user_id);

  // Everyone votes out an innocent villager instead of the wolf.
  const scapegoat = villagers[0].user_id;
  for (const voterId of everyone) {
    await handleVote(
      fakeInteraction({ prefix: PREFIX_VOTE, lobbyId, guild, client, userId: voterId, values: [scapegoat] }),
      settings
    );
  }

  session = await getSession(lobbyId);
  assert.equal(session.phase, "NIGHT");
  assert.equal(session.players.find((player) => player.user_id === scapegoat).alive, false);

  // The lone wolf votes in the wolves' den - the only vote needed to close the night.
  const nightTarget = villagers[1].user_id;
  await handleVote(
    fakeInteraction({ prefix: PREFIX_VOTE, lobbyId, guild, client, userId: wolf.user_id, values: [nightTarget] }),
    settings
  );

  session = await getSession(lobbyId);
  assert.equal(session.phase, "RESULT");
  assert.equal(session.winner, "WOLVES", "one wolf against one villager - the wolves already have it won");

  await handleSkip(fakeInteraction({ prefix: PREFIX_SKIP, lobbyId, guild, client, userId: leaderId }), settings);
  assert.equal(await getSession(lobbyId), null);
  assert.equal(guild._channels.get(lobbyId), undefined);
});

test("advancePhase ignores a stale expectedPhase, so a late timer never reprocesses a phase that already moved on", async () => {
  const guildId = freshId();
  const guild = fakeGuild({ id: guildId });
  const client = fakeClient(guild);
  await seedGuildSettings(guildId, { forest_fuss_enabled: true });

  const leaderId = freshId();
  addMember(guild, leaderId);
  const settings = settingsWith({ forest_fuss_enabled: true });
  const { channel } = await startSession({ client, guild, leader: { id: leaderId }, settings });
  const lobbyId = channel.id;

  await handleStop(fakeInteraction({ prefix: PREFIX_STOP, lobbyId, guild, client, userId: leaderId }), settings);
  assert.equal(await getSession(lobbyId), null);

  // The scheduled deadline for the now-deleted session must not throw.
  await assert.doesNotReject(advancePhase(client, lobbyId, { expectedPhase: "RECRUITMENT" }));
});
