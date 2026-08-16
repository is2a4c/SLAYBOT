const test = require("node:test");
const assert = require("node:assert/strict");
require("module-alias/register");

const {
  accessProblem,
  executeCommand,
  messagePayload,
  renderTemplate,
  resetCooldowns,
  tryCustomCommand,
} = require("../src/services/customCommands/CustomCommandRuntime");
const {
  CustomCommandError,
  actionFromInput,
  commandName,
  createCommand,
} = require("../dashboard/services/customCommands");

const GUILD_ID = "100000000000000000";
const CHANNEL_ID = "100000000000000001";
const ROLE_ID = "100000000000000002";

function guild() {
  return {
    id: GUILD_ID,
    name: "Test Server",
    channels: { cache: new Map([[CHANNEL_ID, { id: CHANNEL_ID, isTextBased: () => true, isThread: () => false }]]) },
    roles: { cache: new Map([[ROLE_ID, { id: ROLE_ID, managed: false, editable: true }]]) },
    emojis: { cache: new Map() },
  };
}

function message() {
  const server = guild();
  const sent = [];
  const channel = {
    ...server.channels.cache.get(CHANNEL_ID),
    send: async (payload) => {
      sent.push(payload);
      return payload;
    },
  };
  server.channels.cache.set(CHANNEL_ID, channel);
  const roleCalls = [];
  const directMessages = [];
  const reactions = [];
  return {
    guild: server,
    guildId: GUILD_ID,
    channel,
    channelId: CHANNEL_ID,
    content: "!hello one two",
    author: { id: "100000000000000003" },
    member: {
      id: "100000000000000003",
      displayName: "Tester",
      guild: server,
      roles: {
        cache: new Map([[ROLE_ID, { id: ROLE_ID }]]),
        add: async (ids) => roleCalls.push(["add", ids]),
        remove: async (ids) => roleCalls.push(["remove", ids]),
      },
      send: async (payload) => {
        directMessages.push(payload);
        return payload;
      },
    },
    safeReply: async (payload) => sent.push(payload),
    deletable: false,
    sent,
    roleCalls,
    directMessages,
    reactions,
    react: async (emoji) => reactions.push(emoji),
  };
}

test("custom command names and action inputs are bounded", async () => {
  assert.equal(commandName(" Hello_world "), "hello_world");
  assert.throws(() => commandName("not valid"), CustomCommandError);
  const action = actionFromInput(guild(), {
    type: "SEND_MESSAGE",
    content: "Hello {member:name}",
    embedTitle: "Welcome",
    embedColor: "#abcdef",
    channelId: CHANNEL_ID,
  });
  assert.equal(action.type, "SEND_MESSAGE");
  assert.equal(action.channel_id, CHANNEL_ID);

  const created = await createCommand(
    guild(),
    { name: "hello", description: "Greeting" },
    { getCommand: () => null },
    { countDocuments: async () => 0, create: async (value) => ({ ...value, _id: "id" }) }
  );
  assert.equal(created.name, "hello");
});

test("templates expose only documented invocation values and suppress broad mentions", async () => {
  const msg = message();
  const context = { guild: msg.guild, channel: msg.channel, member: msg.member, arguments: ["one", "two"] };
  assert.equal(renderTemplate("{server}|{member:name}|{arguments}", context), "Test Server|Tester|one two");
  const payload = await messagePayload({ content: "Hi {member:mention} @everyone" }, context);
  assert.equal(payload.content, "Hi <@100000000000000003> @everyone");
  assert.deepEqual(payload.allowedMentions, { users: ["100000000000000003"], roles: [], parse: [] });
  const controlled = await messagePayload({ content: "<@&role>", mention_roles: [ROLE_ID], tts: true }, context);
  assert.deepEqual(controlled.allowedMentions.roles, [ROLE_ID]);
  assert.equal(controlled.tts, true);
});

test("runtime executes ordered channel, DM, reaction and role actions", async () => {
  const msg = message();
  const command = {
    _id: "command",
    cooldown_seconds: 0,
    allowed_roles: [],
    allowed_channels: [],
    actions: [
      { type: "SEND_MESSAGE", content: "Hello {member:name}" },
      { type: "SEND_DM", content: "Private {member:name}" },
      { type: "ADD_REACTION", emoji: "✅" },
      { type: "CHANGE_ROLES", add_roles: [ROLE_ID], remove_roles: [] },
    ],
  };
  const result = await executeCommand(command, msg, []);
  assert.equal(result.executed, true);
  assert.equal(msg.sent[0].content, "Hello Tester");
  assert.equal(msg.directMessages[0].content, "Private Tester");
  assert.deepEqual(msg.reactions, ["✅"]);
  assert.deepEqual(msg.roleCalls, [["add", [ROLE_ID]]]);
});

test("dashboard validates DM and reaction actions without accepting arbitrary action types", () => {
  const dm = actionFromInput(guild(), {
    type: "SEND_DM",
    content: "Private",
    channelId: CHANNEL_ID,
    mentionRoles: [ROLE_ID],
    tts: "on",
    deleteAfterSeconds: "90",
  });
  assert.equal(dm.type, "SEND_DM");
  assert.equal(dm.channel_id, null);
  assert.equal(dm.tts, true);
  assert.equal(dm.delete_after_seconds, 90);
  assert.deepEqual(dm.mention_roles, [ROLE_ID]);

  const reaction = actionFromInput(guild(), { type: "ADD_REACTION", emoji: "✅" });
  assert.equal(reaction.emoji, "✅");
  assert.throws(() => actionFromInput(guild(), { type: "ADD_REACTION", emoji: "not emoji" }), CustomCommandError);
  assert.equal(actionFromInput(guild(), { type: "UNKNOWN", content: "safe fallback" }).type, "SEND_MESSAGE");
});

test("custom invocation honours feature switch, channel, and role access", async () => {
  const msg = message();
  const command = {
    _id: "command",
    cooldown_seconds: 0,
    allowed_roles: [ROLE_ID],
    allowed_channels: [CHANNEL_ID],
    actions: [{ type: "SEND_MESSAGE", content: "ok" }],
  };
  assert.equal(accessProblem(command, msg), null);
  const result = await tryCustomCommand(
    msg,
    { prefix: "!", control_center: { common: { text_commands: true } } },
    { model: { findOne: async () => command } }
  );
  assert.equal(result.handled, true);
  const disabled = await tryCustomCommand(msg, { prefix: "!", control_center: { common: { text_commands: false } } });
  assert.deepEqual(disabled, { handled: false });
});

test("a server's moderator roles skip a custom command's cooldown, the same way they skip a built-in one's", async () => {
  resetCooldowns();
  const command = {
    _id: "moderated-command",
    cooldown_seconds: 60,
    allowed_roles: [],
    allowed_channels: [],
    actions: [{ type: "SEND_MESSAGE", content: "ok" }],
  };
  const msg = message();
  const settings = { control_center: { moderation: { moderator_roles: [ROLE_ID] } } };

  const first = await executeCommand(command, msg, []);
  assert.equal(first.executed, true);

  const blocked = await executeCommand(command, msg, []);
  assert.equal(blocked.executed, false, "a second run without the exemption is still on cooldown");

  const exempt = await executeCommand(command, msg, [], {}, settings);
  assert.equal(exempt.executed, true, "the moderator-role exemption bypasses the same cooldown");
});
