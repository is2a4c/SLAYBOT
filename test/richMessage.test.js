const test = require("node:test");
const assert = require("node:assert/strict");
require("module-alias/register");

const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const {
  RichMessageError,
  buildEmbed,
  buildFields,
  buildLinkButtons,
  buildPayload,
  sanitizeButtons,
  sanitizeFields,
  sanitizePoll,
  startPollFromConfig,
  stringifyButtons,
  stringifyFields,
} = require("@src/services/richMessage/RichMessage");
const { buildGreeting } = require("@src/handlers/greeting");
const { messagePayload, runAction } = require("@src/services/customCommands/CustomCommandRuntime");
const { actionFromInput, CustomCommandError } = require("../dashboard/services/customCommands");
const { parseField, fieldsForView, ADVANCED_FIELDS } = require("../dashboard/services/advancedSettings");
const { model: pollModel } = require("@schemas/Poll");
const { model: taskModel } = require("@schemas/ScheduledTask");

const GUILD_ID = "100000000000000000";
const CHANNEL_ID = "100000000000000001";
const ROLE_ID = "100000000000000002";

let mongo;

test.before(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
});

test.after(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

test.beforeEach(async () => {
  await pollModel.deleteMany({});
  await taskModel.deleteMany({});
});

/* -------------------------------------------------------------------- fields */

test("buildFields drops a field missing a name or a value, and caps the rest", async () => {
  const fields = await buildFields([
    { name: "Rules", value: "Read #rules", inline: true },
    { name: "", value: "orphaned" },
    { name: "orphaned", value: "" },
  ]);
  assert.deepEqual(fields, [{ name: "Rules", value: "Read #rules", inline: true }]);
});

test("buildFields awaits an async renderText the same way a sync one is used", async () => {
  const fields = await buildFields([{ name: "{x}", value: "{y}" }], async (value) =>
    value.replace("{x}", "Name").replace("{y}", "Value")
  );
  assert.deepEqual(fields, [{ name: "Name", value: "Value", inline: false }]);
});

/* --------------------------------------------------------------------- embed */

test("buildEmbed is null when nothing at all is set", async () => {
  assert.equal(await buildEmbed({ title: null, description: null }), null);
  assert.equal(await buildEmbed(null), null);
});

test("buildEmbed builds every piece it is given", async () => {
  const embed = await buildEmbed({
    title: "Hello",
    description: "World",
    author: "Server",
    footer: "Footer",
    thumbnail: "https://cdn/thumb.png",
    image: "https://cdn/image.png",
    color: "#ABCDEF",
    timestamp: true,
    fields: [{ name: "A", value: "B" }],
  });

  const data = embed.toJSON();
  assert.equal(data.title, "Hello");
  assert.equal(data.description, "World");
  assert.equal(data.author.name, "Server");
  assert.equal(data.footer.text, "Footer");
  assert.equal(data.thumbnail.url, "https://cdn/thumb.png");
  assert.equal(data.image.url, "https://cdn/image.png");
  assert.equal(data.color, 0xabcdef);
  assert.ok(data.timestamp);
  assert.deepEqual(data.fields, [{ name: "A", value: "B", inline: false }]);
});

test("buildEmbed refuses a non-https thumbnail or image rather than sending it broken", async () => {
  const embed = await buildEmbed({ thumbnail: "http://insecure/x.png", image: "javascript:alert(1)", title: "T" });
  const data = embed.toJSON();
  assert.equal(data.thumbnail, undefined);
  assert.equal(data.image, undefined);
});

/* ------------------------------------------------------------------- buttons */

test("buildLinkButtons keeps only what Discord would actually accept", async () => {
  const rows = await buildLinkButtons([
    { label: "Docs", url: "https://example.com/docs" },
    { label: "", url: "https://example.com/blank-label" },
    { label: "No URL", url: "" },
    { label: "Unsafe", url: "javascript:alert(1)" },
  ]);

  assert.equal(rows.length, 1);
  const buttons = rows[0].components.map((button) => button.data);
  assert.equal(buttons.length, 1);
  assert.equal(buttons[0].label, "Docs");
  assert.equal(buttons[0].style, 5, "link style");
  assert.equal(buttons[0].url, "https://example.com/docs");
});

test("no buttons at all means no component row, not an empty one", async () => {
  assert.deepEqual(await buildLinkButtons([]), []);
  assert.deepEqual(await buildLinkButtons(null), []);
});

/* ------------------------------------------------------------------- payload */

test("buildPayload is null for a message with nothing to send", async () => {
  assert.equal(await buildPayload({}), null);
});

test("buildPayload only ever allows the self-mention and the chosen roles", async () => {
  const payload = await buildPayload({ content: "hi @everyone", tts: true }, (value) => value, {
    selfMention: "1",
    roleMentions: [ROLE_ID],
  });
  assert.equal(payload.content, "hi @everyone");
  assert.equal(payload.tts, true);
  assert.deepEqual(payload.allowedMentions, { users: ["1"], roles: [ROLE_ID], parse: [] });
});

/* ------------------------------------------------------------- dashboard input */

test("sanitizeFields parses the compact line format and rejects what cannot be sent", () => {
  assert.deepEqual(sanitizeFields("Rules | Read #rules | inline\nExtra | Plain"), [
    { name: "Rules", value: "Read #rules", inline: true },
    { name: "Extra", value: "Plain", inline: false },
  ]);
  assert.deepEqual(sanitizeFields(""), []);
  assert.throws(() => sanitizeFields("Name only"), RichMessageError);
  assert.throws(() => sanitizeFields(Array.from({ length: 26 }, (_, i) => `f${i} | v${i}`).join("\n")), /at most 25/);
});

test("sanitizeButtons requires a real https link", () => {
  assert.deepEqual(sanitizeButtons("Support | https://discord.gg/x | 🛟"), [
    { label: "Support", url: "https://discord.gg/x", emoji: "🛟" },
  ]);
  assert.throws(() => sanitizeButtons("Support | ftp://nope"), RichMessageError);
  assert.throws(
    () => sanitizeButtons(Array.from({ length: 6 }, (_, i) => `b${i} | https://x/${i}`).join("\n")),
    /at most 5/
  );
});

test("sanitizePoll is optional, but half-filled is refused", () => {
  assert.equal(sanitizePoll({}), null);
  assert.throws(() => sanitizePoll({ pollOptions: "a\nb" }), /needs a question/);
  assert.throws(() => sanitizePoll({ pollQuestion: "q?", pollOptions: "only one" }), /at least two options/);
  assert.throws(
    () => sanitizePoll({ pollQuestion: "q?", pollOptions: "a\nb", pollDuration: "not a number" }),
    /duration/
  );

  const poll = sanitizePoll({
    pollQuestion: " Pick one ",
    pollOptions: "a\nb\nb ",
    pollMulti: "on",
    pollDuration: "30",
  });
  assert.equal(poll.question, "Pick one");
  assert.deepEqual(poll.options, ["a", "b", "b"]);
  assert.equal(poll.multi, true);
  assert.equal(poll.duration_minutes, 30);
});

test("stringify and sanitize round-trip the same data", () => {
  const fields = sanitizeFields("Rules | Read #rules | inline");
  assert.deepEqual(sanitizeFields(stringifyFields(fields)), fields);

  const buttons = sanitizeButtons("Support | https://discord.gg/x");
  assert.deepEqual(sanitizeButtons(stringifyButtons(buttons)), buttons);
});

/* ---------------------------------------------------------------- poll start */

function mockChannel() {
  const sent = { id: "900000000000000001" };
  sent.edit = async (payload) => {
    sent.editedWith = payload;
    return sent;
  };
  return {
    id: CHANNEL_ID,
    toString: () => `<#${CHANNEL_ID}>`,
    isTextBased: () => true,
    permissionsFor: () => ({ has: () => true }),
    send: async () => sent,
  };
}

function mockGuildWithChannel(channel) {
  return { id: GUILD_ID, members: { me: {} }, channels: { cache: new Map([[channel.id, channel]]) } };
}

test("startPollFromConfig does nothing when no poll was configured", async () => {
  const channel = mockChannel();
  const result = await startPollFromConfig({
    guild: mockGuildWithChannel(channel),
    channel,
    authorId: "1",
    poll: null,
  });
  assert.equal(result, null);
  assert.equal(await pollModel.countDocuments({}), 0);
});

test("startPollFromConfig posts a real poll and schedules its close", async () => {
  const channel = mockChannel();
  const guild = mockGuildWithChannel(channel);

  const result = await startPollFromConfig({
    guild,
    channel,
    authorId: "42",
    poll: { question: "Best snack?", options: ["Chips", "Fruit"], multi: false, duration_minutes: 60 },
  });

  assert.ok(result.poll._id);
  assert.equal(result.poll.question, "Best snack?");

  const stored = await pollModel.findOne({ guild_id: GUILD_ID });
  assert.ok(stored, "the poll is really in the database, not just returned");
  assert.equal(stored.author_id, "42");

  const scheduled = await taskModel.findOne({ type: "POLL_CLOSE" });
  assert.ok(scheduled, "a duration schedules the auto-close");
});

/* ---------------------------------------------------------------- greeting */

function member() {
  return {
    displayName: "Ann",
    displayAvatarURL: () => "https://cdn/avatar.png",
    toString: () => "<@1>",
    guild: { name: "Slay", memberCount: 10 },
    user: {
      bot: false,
      username: "ann",
      discriminator: "0",
      globalName: "Ann",
      displayAvatarURL: () => "https://cdn/avatar.png",
    },
  };
}

test("a greeting carries its configured fields and link buttons", async () => {
  const payload = await buildGreeting(member(), "WELCOME", {
    content: null,
    embed: {
      title: "Hi",
      author: null,
      description: null,
      color: null,
      thumbnail: false,
      footer: null,
      image: null,
      timestamp: false,
    },
    fields: [{ name: "Rule 1", value: "Be kind", inline: false }],
    buttons: [{ label: "Rules", url: "https://example.com/rules" }],
  });

  assert.deepEqual(payload.embeds[0].data.fields, [{ name: "Rule 1", value: "Be kind", inline: false }]);
  assert.equal(payload.components.length, 1);
  assert.equal(payload.components[0].components[0].data.label, "Rules");
});

test("a greeting with nothing but a button still sends the default text and the button", async () => {
  const payload = await buildGreeting(member(), "FAREWELL", {
    content: null,
    embed: {
      title: null,
      author: null,
      description: null,
      color: null,
      thumbnail: false,
      footer: null,
      image: null,
      timestamp: false,
    },
    fields: [],
    buttons: [{ label: "Rejoin", url: "https://example.com/invite" }],
  });

  assert.match(payload.content, /has left the server/);
  assert.equal(payload.components.length, 1);
});

/* -------------------------------------------------------- custom command actions */

function ccGuild(channel, fallbackChannel) {
  const cache = new Map([[channel.id, channel]]);
  if (fallbackChannel) cache.set(fallbackChannel.id, fallbackChannel);
  return { id: GUILD_ID, name: "G", members: { me: {} }, channels: { cache }, roles: { cache: new Map() } };
}

test("messagePayload for a custom command action carries fields and buttons through", async () => {
  const guild = { name: "G" };
  const context = {
    guild,
    channel: { id: CHANNEL_ID },
    member: { id: "1", displayName: "T" },
    arguments: [],
    options: {},
  };
  const payload = await messagePayload(
    {
      content: "hi",
      fields: [{ name: "A", value: "B" }],
      buttons: [{ label: "Docs", url: "https://example.com" }],
    },
    context
  );
  assert.equal(payload.embeds.length, 1, "fields alone are still enough to need an embed to hold them");
  assert.deepEqual(payload.embeds[0].data.fields, [{ name: "A", value: "B", inline: false }]);
  assert.equal(payload.components.length, 1);
  assert.equal(payload.content, "hi");
});

test("a channel action falls back to the invocation channel when its own target is gone", async () => {
  const sent = [];
  const invocationChannel = {
    id: "900000000000000002",
    isTextBased: () => true,
    send: async (payload) => {
      sent.push(payload);
      return { id: "m1" };
    },
  };
  const guild = ccGuild(invocationChannel);
  const message = {
    guild,
    guildId: GUILD_ID,
    channel: invocationChannel,
    channelId: invocationChannel.id,
    member: { id: "1", displayName: "T", guild },
    author: { id: "1" },
  };

  await runAction(
    { channel_id: "900000000000000099", content: "hello", fields: [], buttons: [], type: "SEND_MESSAGE" },
    message,
    { guild, channel: invocationChannel, member: message.member, arguments: [], options: {} }
  );

  assert.equal(sent.length, 1, "the message still went out, in the channel the command was run in");
});

test("a poll action starts a poll instead of sending a plain message", async () => {
  const channel = mockChannel();
  const guild = ccGuild(channel);
  const message = {
    guild,
    guildId: GUILD_ID,
    channel,
    channelId: channel.id,
    member: { id: "1", displayName: "T", guild },
    author: { id: "1" },
  };

  await runAction(
    {
      poll: { question: "Q?", options: ["A", "B"], multi: false, duration_minutes: null },
      content: "ignored",
      fields: [],
      buttons: [],
      type: "SEND_MESSAGE",
    },
    message,
    { guild, channel, member: message.member, arguments: [], options: {} }
  );

  const stored = await pollModel.findOne({ guild_id: GUILD_ID });
  assert.ok(stored, "the poll action really created a poll");
  assert.equal(stored.question, "Q?");
});

/* ------------------------------------------------------------ dashboard input */

function ccInputGuild() {
  return {
    id: GUILD_ID,
    channels: { cache: new Map([[CHANNEL_ID, { id: CHANNEL_ID, isTextBased: () => true, isThread: () => false }]]) },
    roles: { cache: new Map([[ROLE_ID, { id: ROLE_ID, managed: false }]]) },
    emojis: { cache: new Map() },
  };
}

test("actionFromInput stores fields and buttons on a message action", () => {
  const action = actionFromInput(ccInputGuild(), {
    type: "SEND_MESSAGE",
    content: "hi",
    fields: "A | B",
    buttons: "Docs | https://example.com",
  });
  assert.deepEqual(action.fields, [{ name: "A", value: "B", inline: false }]);
  assert.deepEqual(action.buttons, [{ label: "Docs", url: "https://example.com", emoji: null }]);
  assert.equal(action.poll, null);
});

test("actionFromInput refuses a poll alongside text, but accepts it alone", () => {
  assert.throws(
    () =>
      actionFromInput(ccInputGuild(), {
        type: "SEND_MESSAGE",
        content: "hi",
        pollQuestion: "Q?",
        pollOptions: "A\nB",
      }),
    CustomCommandError
  );

  const action = actionFromInput(ccInputGuild(), {
    type: "SEND_MESSAGE",
    pollQuestion: "Q?",
    pollOptions: "A\nB",
  });
  assert.equal(action.poll.question, "Q?");
  assert.equal(action.content, null);
});

test("actionFromInput demands something to send when there is no poll either", () => {
  assert.throws(() => actionFromInput(ccInputGuild(), { type: "SEND_MESSAGE" }), CustomCommandError);
});

/* --------------------------------------------------------- advanced settings */

test("advancedSettings parses a server's own welcome fields and buttons", () => {
  const guild = ccInputGuild();
  const fieldsDef = ADVANCED_FIELDS.find((field) => field.id === "welcomeFields");
  const buttonsDef = ADVANCED_FIELDS.find((field) => field.id === "welcomeButtons");

  const fields = parseField(guild, { welcomeFields: "Rule | Be kind" }, fieldsDef, []);
  assert.deepEqual(fields, [{ name: "Rule", value: "Be kind", inline: false }]);

  const buttons = parseField(guild, { welcomeButtons: "Rules | https://example.com" }, buttonsDef, []);
  assert.deepEqual(buttons, [{ label: "Rules", url: "https://example.com", emoji: null }]);
});

test("a malformed fields textarea reverts to what was already stored, like every other field here", () => {
  const guild = ccInputGuild();
  const fieldsDef = ADVANCED_FIELDS.find((field) => field.id === "welcomeFields");
  const current = [{ name: "Kept", value: "As is", inline: false }];

  const result = parseField(guild, { welcomeFields: "not enough parts" }, fieldsDef, current);
  assert.deepEqual(result, current);
});

test("the advanced view shows a server's stored fields back in the compact line format", () => {
  const sections = fieldsForView({
    welcome: { fields: [{ name: "Rule", value: "Be kind", inline: true }], buttons: [] },
    farewell: { fields: [], buttons: [] },
    ai: {},
  });
  const greetings = sections.find((section) => section.id === "greetings");
  const field = greetings.fields.find((entry) => entry.id === "welcomeFields");
  assert.equal(field.value, "Rule | Be kind | inline");
});
