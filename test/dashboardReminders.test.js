const test = require("node:test");
const assert = require("node:assert/strict");
require("module-alias/register");

const { parseBrowserDate, repeatMilliseconds } = require("../dashboard/services/dashboardReminders");
const { normalizePresentation, reminderMention } = require("../src/services/reminders/Reminders");

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
