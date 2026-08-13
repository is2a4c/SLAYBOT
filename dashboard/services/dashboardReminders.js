const { model: taskModel } = require("@schemas/ScheduledTask");
const { MAX_DELAY_MS, MIN_DELAY_MS, createReminder } = require("@src/services/reminders/Reminders");

class DashboardReminderError extends Error {
  constructor(message) {
    super(message);
    this.name = "DashboardReminderError";
  }
}

function parseBrowserDate(value, timezoneOffsetMinutes = 0, now = Date.now()) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(String(value || ""));
  if (!match) throw new DashboardReminderError("Choose a valid date and time.");
  const [, year, month, day, hour, minute] = match.map(Number);
  const offset = Math.min(840, Math.max(-840, Number.parseInt(timezoneOffsetMinutes, 10) || 0));
  const localTime = Date.UTC(year, month - 1, day, hour, minute);
  const localCheck = new Date(localTime);
  if (
    localCheck.getUTCFullYear() !== year ||
    localCheck.getUTCMonth() !== month - 1 ||
    localCheck.getUTCDate() !== day ||
    localCheck.getUTCHours() !== hour ||
    localCheck.getUTCMinutes() !== minute
  ) {
    throw new DashboardReminderError("Choose a real calendar date.");
  }
  const runAt = new Date(localTime + offset * 60_000);
  const delayMs = runAt.getTime() - now;
  if (delayMs < MIN_DELAY_MS) throw new DashboardReminderError("The reminder must be at least 30 seconds ahead.");
  if (delayMs > MAX_DELAY_MS) throw new DashboardReminderError("The reminder cannot be more than one year ahead.");
  return { runAt, delayMs };
}

function repeatMilliseconds(value) {
  const minutes = Number.parseInt(value, 10) || 0;
  if (minutes === 0) return null;
  if (minutes < 5 || minutes > 525600) {
    throw new DashboardReminderError("Repeat interval must be between 5 minutes and one year.");
  }
  return minutes * 60_000;
}

async function createDashboardReminder(guild, actorId, input, now = Date.now()) {
  const channelId = String(input.channelId || "");
  const channel = guild.channels.cache.get(channelId);
  if (!channel?.isTextBased?.() || channel.isThread?.()) {
    throw new DashboardReminderError("Choose a server text channel.");
  }
  const { delayMs } = parseBrowserDate(input.runAt, input.timezoneOffset, now);
  const roleId = String(input.mentionRole || "");
  if (roleId && !guild.roles.cache.has(roleId)) throw new DashboardReminderError("Choose a server role.");
  const mention = roleId ? `ROLE:${roleId}` : String(input.mention || "CREATOR");

  return createReminder({
    guildId: guild.id,
    userId: actorId,
    channelId,
    content: input.content,
    delayMs,
    repeatMs: repeatMilliseconds(input.repeatMinutes),
    presentation: {
      title: input.title,
      footer: input.footer,
      color: input.color,
      mention,
      tts: input.tts === "on",
      deleteAfterSeconds: input.deleteAfterSeconds,
    },
  });
}

const listGuildReminders = (guildId) =>
  taskModel.find({ type: "REMINDER", guild_id: guildId }).sort({ run_at: 1 }).lean();

async function deleteGuildReminder(guildId, id) {
  if (!/^[a-f\d]{24}$/i.test(String(id || ""))) throw new DashboardReminderError("Invalid reminder id.");
  const result = await taskModel.deleteOne({ _id: id, type: "REMINDER", guild_id: guildId });
  if (!result.deletedCount) throw new DashboardReminderError("Reminder no longer exists.");
}

module.exports = {
  DashboardReminderError,
  createDashboardReminder,
  deleteGuildReminder,
  listGuildReminders,
  parseBrowserDate,
  repeatMilliseconds,
};
