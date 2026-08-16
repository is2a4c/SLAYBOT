const test = require("node:test");
const assert = require("node:assert/strict");
require("module-alias/register");

const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const { model: guildModel } = require("@schemas/Guild");
const { runAction, contextTarget } = require("@src/services/customCommands/CustomCommandRuntime");
const { CustomCommandError, actionFromInput } = require("../dashboard/services/customCommands");

let mongo;
let nextId = 700000000000000000n;
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

// The exact harness proven against ModUtils itself this session - reused
// rather than reinvented, so TIMEOUT_TARGET is tested against the same
// hierarchy/mute-mode behavior, not a simplified stand-in for it.
function fakeGuild(id) {
  const guild = {
    id,
    name: "Test Guild",
    ownerId: freshId(),
    iconURL: () => null,
    roles: { cache: new Map() },
    channels: { cache: new Map() },
    members: { me: null },
    client: { logger: { warn: () => {}, error: () => {}, debug: () => {} } },
  };
  guild.members.me = { id: "bot-1", guild, permissions: { has: () => true }, roles: { highest: { position: 1000 } } };
  return guild;
}

function fakeMember({ guild, id = freshId(), position = 1 }) {
  const held = new Set();
  const member = {
    id,
    guild,
    displayName: `member-${id}`,
    displayAvatarURL: () => null,
    user: { id, username: `member-${id}`, bot: false, send: async () => {} },
    client: guild.client,
    communicationDisabledUntilTimestamp: 0,
    roles: {
      highest: { position },
      cache: { has: (roleId) => held.has(roleId) },
      add: async (role) => held.add(role.id ?? role),
      remove: async (role) => held.delete(role.id ?? role),
    },
    send: async () => {},
    async timeout(ms) {
      this.communicationDisabledUntilTimestamp = ms === null ? 0 : Date.now() + ms;
    },
  };
  return member;
}

function contextFor(guild, issuer, target) {
  return {
    guild,
    channel: { id: "channel-1" },
    member: issuer,
    arguments: [],
    target: target ? { id: target.id, name: target.displayName, content: "", member: target } : null,
    options: {},
  };
}

/* --------------------------------------------------------------- TIMEOUT_TARGET */

test("TIMEOUT_TARGET mutes the resolved context member, honouring the same hierarchy /timeout would", async () => {
  const guildId = await seedSettings({});
  const guild = fakeGuild(guildId);
  const issuer = fakeMember({ guild, position: 10 });
  const target = fakeMember({ guild, position: 1 });

  const action = { type: "TIMEOUT_TARGET", duration_minutes: 30, reason: "Muted by {member:name}" };
  await runAction(action, { member: issuer }, contextFor(guild, issuer, target));

  assert.ok(target.communicationDisabledUntilTimestamp > Date.now(), "the target is actually muted");
});

test("TIMEOUT_TARGET refuses when the issuer does not outrank the target - exactly like /timeout would", async () => {
  const guildId = await seedSettings({});
  const guild = fakeGuild(guildId);
  const issuer = fakeMember({ guild, position: 1 });
  const target = fakeMember({ guild, position: 10 });

  await runAction(
    { type: "TIMEOUT_TARGET", duration_minutes: 10, reason: null },
    { member: issuer },
    contextFor(guild, issuer, target)
  );

  assert.equal(target.communicationDisabledUntilTimestamp, 0, "hierarchy blocked the mute, so nothing happened");
});

test("TIMEOUT_TARGET does nothing, and does not crash, without a real target member", async () => {
  const guildId = await seedSettings({});
  const guild = fakeGuild(guildId);
  const issuer = fakeMember({ guild, position: 10 });

  await assert.doesNotReject(
    runAction({ type: "TIMEOUT_TARGET", duration_minutes: 10 }, { member: issuer }, contextFor(guild, issuer, null))
  );
});

test("UNTIMEOUT_TARGET removes an active mute", async () => {
  const guildId = await seedSettings({});
  const guild = fakeGuild(guildId);
  const issuer = fakeMember({ guild, position: 10 });
  const target = fakeMember({ guild, position: 1 });
  target.communicationDisabledUntilTimestamp = Date.now() + 60_000;

  await runAction(
    { type: "UNTIMEOUT_TARGET", reason: "Cleared" },
    { member: issuer },
    contextFor(guild, issuer, target)
  );

  assert.equal(target.communicationDisabledUntilTimestamp, 0);
});

/* ---------------------------------------------------------------- contextTarget */

test("contextTarget resolves the real member for a member context menu", () => {
  const guild = fakeGuild(freshId());
  const target = fakeMember({ guild, position: 1 });
  const interaction = {
    isMessageContextMenuCommand: () => false,
    targetMember: target,
    targetUser: null,
  };

  const resolved = contextTarget(interaction);
  assert.equal(resolved.id, target.id);
  assert.equal(resolved.member, target);
});

test("contextTarget resolves a message context menu's author from the guild's own cache", () => {
  const guild = fakeGuild(freshId());
  const author = fakeMember({ guild, position: 1 });
  guild.members.cache = new Map([[author.id, author]]);
  const interaction = {
    isMessageContextMenuCommand: () => true,
    guild,
    targetMessage: { id: "msg-1", author: { id: author.id, username: "author" }, content: "hi" },
  };

  const resolved = contextTarget(interaction);
  assert.equal(resolved.member, author);
});

test("contextTarget degrades to no member, not a crash, when nobody is resolvable", () => {
  assert.equal(contextTarget({ isMessageContextMenuCommand: () => false, targetMember: null, targetUser: null }), null);

  const interaction = {
    isMessageContextMenuCommand: () => true,
    guild: { members: { cache: new Map() } },
    targetMessage: { id: "msg-1", author: { id: "ghost", username: "ghost" }, content: "hi" },
  };
  assert.equal(contextTarget(interaction).member, null);
});

/* --------------------------------------------------------------- dashboard input */

test("a moderation action needs a context menu trigger before it can be added", () => {
  assert.throws(
    () =>
      actionFromInput(
        {},
        { type: "TIMEOUT_TARGET", durationMinutes: "10" },
        { actions: [], triggers: { slash: true } }
      ),
    /message or member context menu trigger/
  );

  const command = { actions: [], triggers: { member_context: true } };
  const action = actionFromInput({}, { type: "TIMEOUT_TARGET", durationMinutes: "15", reason: "Spam" }, command);
  assert.equal(action.duration_minutes, 15);
  assert.equal(action.reason, "Spam");

  const untimeout = actionFromInput({}, { type: "UNTIMEOUT_TARGET", reason: "" }, command);
  assert.equal(untimeout.reason, null);
});

test("a timeout action needs a real duration", () => {
  const command = { actions: [], triggers: { message_context: true } };
  assert.throws(
    () => actionFromInput({}, { type: "TIMEOUT_TARGET", durationMinutes: "0" }, command),
    CustomCommandError
  );
  assert.throws(
    () => actionFromInput({}, { type: "TIMEOUT_TARGET", durationMinutes: "not a number" }, command),
    CustomCommandError
  );

  const capped = actionFromInput({}, { type: "TIMEOUT_TARGET", durationMinutes: "999999" }, command);
  assert.equal(capped.duration_minutes, 40320, "a duration above Discord's own ceiling is capped, not rejected");
});
