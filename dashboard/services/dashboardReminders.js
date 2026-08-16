const { model: taskModel } = require("@schemas/ScheduledTask");
const {
  MAX_DELAY_MS,
  MIN_DELAY_MS,
  ReminderError,
  assertMessageOrPoll,
  buildReminderEmbed,
  createReminder,
  normalizePresentation,
  reminderMention,
} = require("@src/services/reminders/Reminders");
const { RichMessageError, sanitizePoll } = require("@src/services/richMessage/RichMessage");

const PAGE_SIZE = 25;

class DashboardReminderError extends Error {
  constructor(message) {
    super(message);
    this.name = "DashboardReminderError";
  }
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

/**
 * What both creating and previewing a reminder need to agree on: a real
 * channel, a real role if one was picked, and a message that is either text
 * or a poll but never neither and never both.
 *
 * @param {import('discord.js').Guild} guild
 * @param {object} input
 */
function parseDashboardReminderInput(guild, input) {
  const channelId = String(input.channelId || "");
  const channel = guild.channels.cache.get(channelId);
  if (!channel?.isTextBased?.() || channel.isThread?.()) {
    throw new DashboardReminderError("Choose a server text channel.");
  }
  const roleId = String(input.mentionRole || "");
  if (roleId && !guild.roles.cache.has(roleId)) throw new DashboardReminderError("Choose a server role.");
  const mention = roleId ? `ROLE:${roleId}` : String(input.mention || "CREATOR");

  let poll;
  try {
    poll = sanitizePoll(input);
  } catch (error) {
    if (error instanceof RichMessageError) throw new DashboardReminderError(error.message);
    throw error;
  }

  const content = String(input.content || "").trim();
  try {
    assertMessageOrPoll(content, poll);
  } catch (error) {
    if (error instanceof ReminderError) throw new DashboardReminderError(error.message);
    throw error;
  }

  return {
    channelId,
    content,
    poll,
    presentation: {
      title: input.title,
      footer: input.footer,
      color: input.color,
      mention,
      tts: input.tts === "on",
      deleteAfterSeconds: input.deleteAfterSeconds,
      crosspost: input.crosspost === "on",
    },
  };
}

async function createDashboardReminder(guild, actorId, input, now = Date.now()) {
  const parsed = parseDashboardReminderInput(guild, input);
  const { delayMs } = parseBrowserDate(input.runAt, input.timezoneOffset, now);

  try {
    return await createReminder({
      guildId: guild.id,
      userId: actorId,
      channelId: parsed.channelId,
      content: parsed.content,
      delayMs,
      repeatMs: repeatMilliseconds(input.repeatMinutes),
      presentation: parsed.presentation,
      poll: parsed.poll,
    });
  } catch (error) {
    if (error instanceof ReminderError) throw new DashboardReminderError(error.message);
    throw error;
  }
}

/**
 * The exact embed or poll a reminder will fire with, built without scheduling
 * anything - so what an admin previews is never able to drift from what
 * actually gets sent.
 *
 * @param {import('discord.js').Guild} guild
 * @param {string} actorId
 * @param {object} input
 */
function previewDashboardReminder(guild, actorId, input) {
  const parsed = parseDashboardReminderInput(guild, input);
  if (parsed.poll) return { poll: parsed.poll };

  const presentation = normalizePresentation(parsed.presentation);
  const embed = buildReminderEmbed({ content: parsed.content, presentation }, Date.now());
  const mention = reminderMention({ userId: actorId, presentation });
  return { embed: embed.toJSON(), mention };
}

/**
 * @param {string} guildId
 * @param {{channelId?: string, creatorId?: string, q?: string, page?: number}} [filters]
 */
async function listGuildReminders(guildId, filters = {}) {
  const query = { type: "REMINDER", guild_id: guildId };
  if (filters.channelId) query["payload.channelId"] = filters.channelId;
  if (filters.creatorId) query["payload.userId"] = filters.creatorId;
  if (filters.q) query["payload.content"] = { $regex: escapeRegex(filters.q), $options: "i" };

  const page = Math.max(1, Number.parseInt(filters.page, 10) || 1);
  const [reminders, total] = await Promise.all([
    taskModel
      .find(query)
      .sort({ run_at: 1 })
      .skip((page - 1) * PAGE_SIZE)
      .limit(PAGE_SIZE)
      .lean(),
    taskModel.countDocuments(query),
  ]);

  return { reminders, page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}

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
  previewDashboardReminder,
  repeatMilliseconds,
};
