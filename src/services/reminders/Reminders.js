const { ChannelType, EmbedBuilder, time } = require("discord.js");
const { EMBED_COLORS } = require("@root/config");
const { scheduleTask, listTasks, model: taskModel } = require("@schemas/ScheduledTask");
const { startPollFromConfig } = require("@src/services/richMessage/RichMessage");

const TASK_TYPE = "REMINDER";
const MIN_DELAY_MS = 30_000;
const MAX_DELAY_MS = 365 * 24 * 60 * 60 * 1000;
const MAX_PER_USER = 25;
const MAX_CONTENT = 1000;

class ReminderError extends Error {
  constructor(message) {
    super(message);
    this.name = "ReminderError";
  }
}

/**
 * @param {number} delayMs
 */
function assertDelay(delayMs) {
  if (!Number.isFinite(delayMs)) throw new ReminderError("Provide a delay such as `10m`, `2h` or `3d`.");
  if (delayMs < MIN_DELAY_MS) throw new ReminderError("The delay must be at least 30 seconds.");
  if (delayMs > MAX_DELAY_MS) throw new ReminderError("The delay cannot exceed one year.");
  return delayMs;
}

/**
 * A poll takes over the whole message, the same way it does for a custom
 * command's send-message action - there is no "poll plus text" reminder.
 *
 * @param {string} text
 * @param {object|null} poll
 */
function assertMessageOrPoll(text, poll) {
  if (poll && text) throw new ReminderError("A poll replaces the reminder text — remove the content, or the poll.");
  if (!poll && !text) throw new ReminderError("Tell me what to remind you about.");
}

/**
 * @param {{guildId: string, userId: string, channelId: string, content: string, delayMs: number, repeatMs?: number|null, dm?: boolean, presentation?: object|null, poll?: object|null}} input
 */
async function createReminder({
  guildId,
  userId,
  channelId,
  content,
  delayMs,
  repeatMs = null,
  dm = false,
  presentation = null,
  poll = null,
}) {
  assertDelay(delayMs);

  const text = String(content || "").trim();
  assertMessageOrPoll(text, poll);
  if (text.length > MAX_CONTENT) throw new ReminderError(`Keep the reminder under ${MAX_CONTENT} characters.`);

  if (repeatMs !== null && repeatMs !== undefined) {
    if (!Number.isFinite(repeatMs) || repeatMs < 5 * 60_000) {
      throw new ReminderError("A repeating reminder must repeat at least every 5 minutes.");
    }
  }

  const existing = await listTasks({ type: TASK_TYPE, guildId, payloadMatch: { userId }, limit: MAX_PER_USER + 1 });
  if (existing.length >= MAX_PER_USER) {
    throw new ReminderError(`You already have ${MAX_PER_USER} reminders. Cancel one first.`);
  }

  const remindAt = new Date(Date.now() + delayMs);
  await scheduleTask({
    type: TASK_TYPE,
    guildId,
    runAt: remindAt,
    payload: {
      userId,
      channelId,
      content: text || null,
      repeatMs: repeatMs || null,
      dm: Boolean(dm),
      presentation: normalizePresentation(presentation),
      poll: poll || null,
    },
  });

  return { remindAt };
}

function normalizePresentation(value) {
  if (!value || typeof value !== "object") return null;
  const color = /^#[0-9a-f]{6}$/i.test(String(value.color || "")) ? value.color : null;
  const title =
    String(value.title || "")
      .trim()
      .slice(0, 256) || null;
  const footer =
    String(value.footer || "")
      .trim()
      .slice(0, 2048) || null;
  const mention = /^(NONE|CREATOR|EVERYONE|HERE|ROLE:\d{17,20})$/.test(String(value.mention || ""))
    ? String(value.mention)
    : "CREATOR";
  const deleteAfterSeconds = Math.min(86400, Math.max(0, Number.parseInt(value.deleteAfterSeconds, 10) || 0));
  return {
    title,
    footer,
    color,
    mention,
    tts: Boolean(value.tts),
    deleteAfterSeconds,
    crosspost: Boolean(value.crosspost),
  };
}

/**
 * The embed a reminder shows when it fires - built the same way whether it is
 * actually being sent or only being previewed before it is saved.
 *
 * @param {{content: string, presentation?: object|null}} payload
 * @param {Date|number} createdAt
 */
function buildReminderEmbed(payload, createdAt) {
  const presentation = normalizePresentation(payload.presentation);
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLORS.BOT_EMBED)
    .setAuthor({ name: presentation?.title || "Reminder" })
    .setDescription(payload.content)
    .setFooter({
      text: presentation?.footer || `Set ${new Date(createdAt).toISOString().slice(0, 16).replace("T", " ")} UTC`,
    });
  if (presentation?.color) embed.setColor(presentation.color);
  return embed;
}

function reminderMention(payload) {
  const mention = payload.presentation?.mention || "CREATOR";
  if (mention === "NONE") return { content: null, allowedMentions: { parse: [] } };
  if (mention === "EVERYONE") return { content: "@everyone", allowedMentions: { parse: ["everyone"] } };
  if (mention === "HERE") return { content: "@here", allowedMentions: { parse: ["everyone"] } };
  if (mention.startsWith("ROLE:")) {
    const roleId = mention.slice(5);
    return { content: `<@&${roleId}>`, allowedMentions: { roles: [roleId], parse: [] } };
  }
  return { content: `<@${payload.userId}>`, allowedMentions: { users: [payload.userId], parse: [] } };
}

/**
 * @param {{guildId: string, userId: string}} filter
 */
function listReminders({ guildId, userId }) {
  return listTasks({ type: TASK_TYPE, guildId, payloadMatch: { userId }, limit: MAX_PER_USER });
}

/**
 * Cancel the nth reminder of a user, as numbered by `listReminders`.
 * @param {{guildId: string, userId: string, index: number}} input
 */
async function cancelReminder({ guildId, userId, index }) {
  const reminders = await listReminders({ guildId, userId });
  const target = reminders[index - 1];
  if (!target) throw new ReminderError(`You have no reminder #${index}. Check \`/remind list\`.`);

  // Delete exactly the one that was picked - a payload match would drop them all.
  await taskModel.deleteOne({ _id: target._id });
  return target;
}

/**
 * Scheduler handler: deliver the reminder, then re-arm it when it repeats.
 * @param {object} payload
 * @param {{client: import('discord.js').Client, task: object}} context
 */
async function handleReminder(payload, { client, task }) {
  if (payload.poll?.question) {
    // A poll has nowhere sensible to go as a DM - it only exists as a real
    // channel poll, so a poll reminder set to DM itself simply does nothing.
    if (!payload.dm) {
      const channel = await client.channels.fetch(payload.channelId).catch(() => null);
      if (channel?.isTextBased?.()) {
        await startPollFromConfig({
          guild: channel.guild,
          channel,
          authorId: payload.userId,
          poll: payload.poll,
        }).catch(() => {});
      }
    }
  } else {
    const presentation = normalizePresentation(payload.presentation);
    const embed = buildReminderEmbed(payload, task.created_at);
    const mention = reminderMention({ ...payload, presentation });
    const delivery = { ...mention, embeds: [embed], tts: Boolean(presentation?.tts) };

    let delivered = false;

    if (!payload.dm) {
      const channel = await client.channels.fetch(payload.channelId).catch(() => null);
      if (channel?.isTextBased()) {
        const sent = await channel.send(delivery).catch(() => null);
        delivered = Boolean(sent);
        if (sent && presentation?.deleteAfterSeconds) {
          setTimeout(() => sent.delete().catch(() => {}), presentation.deleteAfterSeconds * 1000).unref?.();
        }
        if (sent && presentation?.crosspost && channel.type === ChannelType.GuildAnnouncement) {
          await sent.crosspost().catch(() => {});
        }
      }
    }

    // Fall back to a DM when the channel is gone or the reminder asked for one.
    if (!delivered) {
      const user = await client.users.fetch(payload.userId).catch(() => null);
      if (user) await user.send({ embeds: [embed] }).catch(() => {});
    }
  }

  if (payload.repeatMs) {
    await scheduleTask({
      type: TASK_TYPE,
      guildId: task.guild_id,
      runAt: new Date(Date.now() + payload.repeatMs),
      payload,
    });
  }
}

/**
 * What a reminder is "about" in one line - its text, or its poll question
 * when it has no text of its own to show.
 *
 * @param {object} reminder task document
 */
function reminderSummary(reminder) {
  return reminder.payload.poll?.question ? `📊 ${reminder.payload.poll.question}` : reminder.payload.content;
}

/**
 * @param {object} reminder task document
 */
function describeReminder(reminder, index) {
  return (
    `**${index}.** ${time(new Date(reminder.run_at), "R")}` +
    `${reminder.payload.repeatMs ? " · repeating" : ""}` +
    `${reminder.payload.dm ? " · via DM" : ` · <#${reminder.payload.channelId}>`}\n` +
    `> ${reminderSummary(reminder).replace(/\n/g, " ").slice(0, 150)}`
  );
}

/**
 * @param {import('@src/services/scheduler/Scheduler').Scheduler} scheduler
 */
function register(scheduler) {
  scheduler.register(TASK_TYPE, handleReminder);
  return scheduler;
}

module.exports = {
  TASK_TYPE,
  MAX_PER_USER,
  MAX_CONTENT,
  MIN_DELAY_MS,
  MAX_DELAY_MS,
  ReminderError,
  assertDelay,
  assertMessageOrPoll,
  buildReminderEmbed,
  cancelReminder,
  createReminder,
  describeReminder,
  handleReminder,
  listReminders,
  normalizePresentation,
  reminderMention,
  reminderSummary,
  register,
};
