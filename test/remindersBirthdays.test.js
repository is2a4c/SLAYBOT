const test = require("node:test");
const assert = require("node:assert/strict");
require("module-alias/register");

const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const { ChannelType } = require("discord.js");
const reminders = require("../src/services/reminders/Reminders");
const birthdays = require("../src/services/birthdays/Birthdays");
const scheduledTask = require("../src/database/schemas/ScheduledTask");
const birthdaySchema = require("../src/database/schemas/Birthday");
const pollSchema = require("../src/database/schemas/Poll");

const GUILD_ID = "456789012345678901";
const USER_ID = "567890123456789012";
const CHANNEL_ID = "678901234567890123";
let mongo;

test.before(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await scheduledTask.model.syncIndexes();
  await birthdaySchema.model.syncIndexes();
});

test.after(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

test.beforeEach(async () => {
  await scheduledTask.model.deleteMany({});
  await birthdaySchema.model.deleteMany({});
});

/* -------------------------------------------------------------------- reminders */

test("reminder delays are validated", () => {
  assert.throws(() => reminders.assertDelay(null), reminders.ReminderError);
  assert.throws(() => reminders.assertDelay(1000), /at least 30 seconds/);
  assert.throws(() => reminders.assertDelay(400 * 24 * 60 * 60 * 1000), /cannot exceed one year/);
  assert.equal(reminders.assertDelay(60_000), 60_000);
});

test("a reminder is stored, listed and cancelled by its list position", async () => {
  await reminders.createReminder({
    guildId: GUILD_ID,
    userId: USER_ID,
    channelId: CHANNEL_ID,
    content: "first",
    delayMs: 60_000,
  });
  await reminders.createReminder({
    guildId: GUILD_ID,
    userId: USER_ID,
    channelId: CHANNEL_ID,
    content: "second",
    delayMs: 120_000,
  });

  const list = await reminders.listReminders({ guildId: GUILD_ID, userId: USER_ID });
  assert.deepEqual(
    list.map((entry) => entry.payload.content),
    ["first", "second"]
  );

  const cancelled = await reminders.cancelReminder({ guildId: GUILD_ID, userId: USER_ID, index: 1 });
  assert.equal(cancelled.payload.content, "first");

  const remaining = await reminders.listReminders({ guildId: GUILD_ID, userId: USER_ID });
  assert.deepEqual(
    remaining.map((entry) => entry.payload.content),
    ["second"],
    "cancelling one reminder must not drop the others"
  );

  await assert.rejects(
    () => reminders.cancelReminder({ guildId: GUILD_ID, userId: USER_ID, index: 9 }),
    /no reminder #9/
  );
});

test("empty and oversized reminders are rejected", async () => {
  const base = { guildId: GUILD_ID, userId: USER_ID, channelId: CHANNEL_ID, delayMs: 60_000 };
  await assert.rejects(() => reminders.createReminder({ ...base, content: "  " }), /what to remind you about/);
  await assert.rejects(
    () => reminders.createReminder({ ...base, content: "x".repeat(reminders.MAX_CONTENT + 1) }),
    /under 1000 characters/
  );
  await assert.rejects(
    () => reminders.createReminder({ ...base, content: "hi", repeatMs: 1000 }),
    /at least every 5 minutes/
  );
});

test("a repeating reminder re-arms itself after firing", async () => {
  const sent = [];
  const client = {
    channels: { fetch: async () => ({ isTextBased: () => true, send: async (payload) => sent.push(payload) }) },
    users: { fetch: async () => null },
  };

  await reminders.handleReminder(
    { userId: USER_ID, channelId: CHANNEL_ID, content: "stand up", repeatMs: 10 * 60_000, dm: false },
    { client, task: { guild_id: GUILD_ID, created_at: new Date() } }
  );

  assert.equal(sent.length, 1);
  const pending = await scheduledTask.model.find({ type: reminders.TASK_TYPE }).lean();
  assert.equal(pending.length, 1, "the repeat was scheduled again");
});

test("a reminder falls back to a DM when the channel is unreachable", async () => {
  const dms = [];
  const client = {
    channels: { fetch: async () => null },
    users: { fetch: async () => ({ send: async (payload) => dms.push(payload) }) },
  };

  await reminders.handleReminder(
    { userId: USER_ID, channelId: CHANNEL_ID, content: "ping", repeatMs: null, dm: false },
    { client, task: { guild_id: GUILD_ID, created_at: new Date() } }
  );

  assert.equal(dms.length, 1);
});

test("a poll replaces the reminder text, never sits alongside it", () => {
  const poll = { question: "Q?", options: ["A", "B"] };
  assert.throws(() => reminders.assertMessageOrPoll("some text", poll), /poll replaces the reminder text/);
  assert.throws(() => reminders.assertMessageOrPoll("", null), /what to remind you about/);
  assert.doesNotThrow(() => reminders.assertMessageOrPoll("", poll));
  assert.doesNotThrow(() => reminders.assertMessageOrPoll("some text", null));
});

test("a poll reminder posts a real poll instead of an embed when it fires", async () => {
  const sent = { id: "poll-message" };
  sent.edit = async (payload) => {
    sent.editedWith = payload;
    return sent;
  };
  const channel = {
    id: CHANNEL_ID,
    isTextBased: () => true,
    permissionsFor: () => ({ has: () => true }),
    send: async () => sent,
  };
  channel.guild = { id: GUILD_ID, members: { me: {} }, channels: { cache: new Map([[CHANNEL_ID, channel]]) } };
  const client = { channels: { fetch: async () => channel }, users: { fetch: async () => null } };

  await reminders.handleReminder(
    { userId: USER_ID, channelId: CHANNEL_ID, dm: false, poll: { question: "Pizza tonight?", options: ["Yes", "No"] } },
    { client, task: { guild_id: GUILD_ID, created_at: new Date() } }
  );

  const stored = await pollSchema.model.findOne({ guild_id: GUILD_ID, question: "Pizza tonight?" });
  assert.ok(stored, "the poll was actually posted, not an embed");
});

test("a reminder configured to publish crossposts itself in an announcement channel", async () => {
  const sent = { crossposted: false };
  sent.crosspost = async () => {
    sent.crossposted = true;
    return sent;
  };
  const channel = { type: ChannelType.GuildAnnouncement, isTextBased: () => true, send: async () => sent };
  const client = { channels: { fetch: async () => channel }, users: { fetch: async () => null } };

  await reminders.handleReminder(
    { userId: USER_ID, channelId: CHANNEL_ID, content: "we shipped it", dm: false, presentation: { crosspost: true } },
    { client, task: { guild_id: GUILD_ID, created_at: new Date() } }
  );

  assert.equal(sent.crossposted, true);
});

test("crosspost is skipped outside an announcement channel, and when it was not requested", async () => {
  let crossposted = false;
  const makeChannel = (type) => ({
    type,
    isTextBased: () => true,
    send: async () => ({ crosspost: async () => (crossposted = true) }),
  });

  await reminders.handleReminder(
    { userId: USER_ID, channelId: CHANNEL_ID, content: "a", dm: false, presentation: { crosspost: true } },
    {
      client: {
        channels: { fetch: async () => makeChannel(ChannelType.GuildText) },
        users: { fetch: async () => null },
      },
      task: { guild_id: GUILD_ID, created_at: new Date() },
    }
  );
  assert.equal(crossposted, false, "not an announcement channel");

  await reminders.handleReminder(
    { userId: USER_ID, channelId: CHANNEL_ID, content: "b", dm: false, presentation: { crosspost: false } },
    {
      client: {
        channels: { fetch: async () => makeChannel(ChannelType.GuildAnnouncement) },
        users: { fetch: async () => null },
      },
      task: { guild_id: GUILD_ID, created_at: new Date() },
    }
  );
  assert.equal(crossposted, false, "crosspost was not requested");
});

test("a poll reminder's summary and listing never touch a null content field", async () => {
  await scheduledTask.scheduleTask({
    type: reminders.TASK_TYPE,
    guildId: GUILD_ID,
    runAt: new Date(Date.now() + 60_000),
    payload: {
      userId: USER_ID,
      channelId: CHANNEL_ID,
      content: null,
      poll: { question: "Snacks?", options: ["Yes", "No"] },
    },
  });

  const [pollReminder] = await reminders.listReminders({ guildId: GUILD_ID, userId: USER_ID });
  assert.equal(reminders.reminderSummary(pollReminder), "📊 Snacks?");
  assert.match(reminders.describeReminder(pollReminder, 1), /📊 Snacks\?/);
});

/* ------------------------------------------------------------------- birthdays */

test("impossible dates are rejected, 29 February is not", () => {
  assert.equal(birthdaySchema.isValidDate(29, 2), true);
  assert.equal(birthdaySchema.isValidDate(30, 2), false);
  assert.equal(birthdaySchema.isValidDate(31, 4), false);
  assert.equal(birthdaySchema.isValidDate(31, 12), true);
  assert.equal(birthdaySchema.isValidDate(0, 5), false);
  assert.equal(birthdaySchema.isValidDate(5, 13), false);
});

test("the next announcement lands on today's hour or tomorrow's", () => {
  const morning = new Date("2026-07-30T06:00:00.000Z");
  assert.equal(birthdays.nextRunAt({ hour: 9, utcOffset: 0, from: morning }).toISOString(), "2026-07-30T09:00:00.000Z");

  const evening = new Date("2026-07-30T20:00:00.000Z");
  assert.equal(birthdays.nextRunAt({ hour: 9, utcOffset: 0, from: evening }).toISOString(), "2026-07-31T09:00:00.000Z");

  // UTC+3 wants 09:00 local, which is 06:00 UTC
  assert.equal(birthdays.nextRunAt({ hour: 9, utcOffset: 3, from: morning }).toISOString(), "2026-07-31T06:00:00.000Z");
});

test("upcoming birthdays wrap around the end of the year", async () => {
  await birthdaySchema.setBirthday({ guildId: GUILD_ID, userId: "1", day: 1, month: 1 });
  await birthdaySchema.setBirthday({ guildId: GUILD_ID, userId: "2", day: 5, month: 8 });
  await birthdaySchema.setBirthday({ guildId: GUILD_ID, userId: "3", day: 30, month: 7 });

  const upcoming = await birthdaySchema.upcomingBirthdays({
    guildId: GUILD_ID,
    from: new Date("2026-07-30T12:00:00.000Z"),
  });

  assert.deepEqual(
    upcoming.map((entry) => entry.user_id),
    ["3", "2", "1"],
    "today first, then this year, then next year"
  );
});

test("the announcement template fills in the member, name, age and server", () => {
  const member = {
    toString: () => "<@1>",
    displayName: "Ann",
    guild: { name: "Slay" },
    user: { displayAvatarURL: () => "" },
  };

  assert.equal(
    birthdays.renderMessage("{member} ({name}) turns {age} on {server}", member, 21),
    "<@1> (Ann) turns 21 on Slay"
  );
  assert.equal(birthdays.renderMessage("{member} turns {age}", member, null), "<@1> turns");
  assert.equal(birthdays.renderMessage(null, member, null), "🎉 Happy birthday <@1>!");
});

test("a birthday is announced once per year and the task re-arms", async () => {
  await birthdaySchema.setBirthday({ guildId: GUILD_ID, userId: USER_ID, day: 30, month: 7, year: 2000 });

  const sent = [];
  const guild = {
    id: GUILD_ID,
    name: "Slay",
    members: {
      me: { roles: { highest: { position: 10 } }, permissions: { has: () => true } },
      fetch: async () => ({
        id: USER_ID,
        toString: () => `<@${USER_ID}>`,
        displayName: "Ann",
        guild: { name: "Slay", id: GUILD_ID },
        user: { displayAvatarURL: () => "https://cdn/a.png" },
        roles: { cache: new Map(), add: async () => {} },
      }),
    },
    channels: {
      cache: new Map([
        [
          CHANNEL_ID,
          {
            isTextBased: () => true,
            permissionsFor: () => ({ has: () => true }),
            send: async (payload) => sent.push(payload),
          },
        ],
      ]),
    },
    roles: { cache: new Map() },
  };

  const client = { guilds: { cache: new Map([[GUILD_ID, guild]]) } };
  const settings = {
    birthdays: { enabled: true, channel_id: CHANNEL_ID, message: "hb {name}", hour: 9, utc_offset: 0 },
  };

  const guildSchema = require("../src/database/schemas/Guild");
  const originalGetSettings = guildSchema.getSettings;
  guildSchema.getSettings = async () => settings;

  try {
    const context = { client, task: { guild_id: GUILD_ID } };
    // The handler compares against "today", so the stored date is today's date.
    const today = new Date();
    await birthdaySchema.setBirthday({
      guildId: GUILD_ID,
      userId: USER_ID,
      day: today.getUTCDate(),
      month: today.getUTCMonth() + 1,
      year: 2000,
    });

    await birthdays.handleAnnouncement({}, context);
    assert.equal(sent.length, 1);
    assert.match(sent[0].embeds[0].data.description, /hb Ann/);

    await birthdays.handleAnnouncement({}, context);
    assert.equal(sent.length, 1, "the same year must not be announced twice");

    const tasks = await scheduledTask.model.find({ type: birthdays.TASK_TYPE }).lean();
    assert.equal(tasks.length, 1, "exactly one re-armed task, thanks to the dedupe key");
  } finally {
    guildSchema.getSettings = originalGetSettings;
  }
});
