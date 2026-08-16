const test = require("node:test");
const assert = require("node:assert/strict");
require("module-alias/register");

const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const {
  DashboardReminderError,
  listGuildReminders,
  parseBrowserDate,
  previewDashboardReminder,
  repeatMilliseconds,
} = require("../dashboard/services/dashboardReminders");
const { createReminder, normalizePresentation, reminderMention } = require("../src/services/reminders/Reminders");

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

function fakeGuild(channelId, roleId) {
  return {
    channels: { cache: new Map([[channelId, { id: channelId, isTextBased: () => true, isThread: () => false }]]) },
    roles: { cache: new Map(roleId ? [[roleId, { id: roleId }]] : []) },
  };
}

test("browser-local reminder time is converted with its timezone offset", () => {
  const now = Date.parse("2026-08-14T08:00:00.000Z");
  const { runAt, delayMs } = parseBrowserDate("2026-08-14T12:00", "-180", now);
  assert.equal(runAt.toISOString(), "2026-08-14T09:00:00.000Z");
  assert.equal(delayMs, 60 * 60 * 1000);
  assert.throws(() => parseBrowserDate("2026-02-30T12:00", 0, now), /real calendar date/);
});

test("repeat interval supports one-time reminders and rejects unsafe ranges", () => {
  assert.equal(repeatMilliseconds("0"), null);
  assert.equal(repeatMilliseconds("15"), 15 * 60_000);
  assert.throws(() => repeatMilliseconds("4"), /between 5 minutes/);
});

test("rich reminder presentation is bounded and mentions are explicit", () => {
  const presentation = normalizePresentation({
    title: " Notice ",
    color: "#aabbcc",
    mention: "ROLE:100000000000000002",
    deleteAfterSeconds: 999999,
    tts: true,
  });
  assert.equal(presentation.title, "Notice");
  assert.equal(presentation.deleteAfterSeconds, 86400);
  assert.equal(presentation.tts, true);
  assert.deepEqual(reminderMention({ userId: "100000000000000003", presentation }), {
    content: "<@&100000000000000002>",
    allowedMentions: { roles: ["100000000000000002"], parse: [] },
  });
});

test("a preview renders the exact embed the reminder would fire with", () => {
  const channelId = freshId();
  const preview = previewDashboardReminder(fakeGuild(channelId), "100000000000000004", {
    channelId,
    content: "Stand up in 5",
    title: "Meeting",
    footer: "See you there",
    color: "#123456",
  });

  assert.equal(preview.embed.author.name, "Meeting");
  assert.equal(preview.embed.description, "Stand up in 5");
  assert.equal(preview.embed.footer.text, "See you there");
  assert.equal(preview.embed.color, 0x123456);
  assert.deepEqual(preview.mention, {
    content: "<@100000000000000004>",
    allowedMentions: { users: ["100000000000000004"], parse: [] },
  });
});

test("a poll preview replaces the embed, and content plus a poll together is rejected", () => {
  const channelId = freshId();
  const preview = previewDashboardReminder(fakeGuild(channelId), "100000000000000004", {
    channelId,
    pollQuestion: "Pizza tonight?",
    pollOptions: "Yes\nNo",
  });
  assert.deepEqual(preview.poll.options, ["Yes", "No"]);
  assert.equal(preview.embed, undefined);

  assert.throws(
    () =>
      previewDashboardReminder(fakeGuild(channelId), "100000000000000004", {
        channelId,
        content: "also this",
        pollQuestion: "Pizza tonight?",
        pollOptions: "Yes\nNo",
      }),
    /poll replaces the reminder text/
  );
});

test("previewing without a real channel, or without content or a poll, is a clear error", () => {
  const channelId = freshId();
  assert.throws(
    () => previewDashboardReminder(fakeGuild(channelId), "100000000000000004", { channelId: "9", content: "hi" }),
    DashboardReminderError
  );
  assert.throws(
    () => previewDashboardReminder(fakeGuild(channelId), "100000000000000004", { channelId }),
    /what to remind you about/
  );
});

test("the reminder queue can be filtered by channel, creator, and text, and paginates", async () => {
  const guildId = freshId();
  const channelA = freshId();
  const channelB = freshId();
  const userA = freshId();
  const userB = freshId();

  await createReminder({ guildId, userId: userA, channelId: channelA, content: "water the plants", delayMs: 60_000 });
  await createReminder({ guildId, userId: userB, channelId: channelB, content: "stand up meeting", delayMs: 90_000 });
  await createReminder({ guildId, userId: userA, channelId: channelB, content: "renew the domain", delayMs: 120_000 });

  const byChannel = await listGuildReminders(guildId, { channelId: channelB });
  assert.equal(byChannel.reminders.length, 2);

  const byCreator = await listGuildReminders(guildId, { creatorId: userA });
  assert.equal(byCreator.reminders.length, 2);

  const byText = await listGuildReminders(guildId, { q: "stand up" });
  assert.equal(byText.reminders.length, 1);
  assert.equal(byText.reminders[0].payload.content, "stand up meeting");

  const paged = await listGuildReminders(guildId, { page: 1 });
  assert.equal(paged.reminders.length, 3);
  assert.equal(paged.pages, 1);
});
