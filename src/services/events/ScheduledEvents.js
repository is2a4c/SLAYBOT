const { EmbedBuilder, GuildScheduledEventEntityType, GuildScheduledEventPrivacyLevel, time } = require("discord.js");
const { EMBED_COLORS } = require("@root/config");
const { scheduleTask, cancelTasks } = require("@schemas/ScheduledTask");

const TASK_TYPE = "EVENT_REMINDER";
const MIN_LEAD_MS = 60_000;
const MAX_LEAD_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
const dedupeKey = (guildId, eventId) => `${TASK_TYPE}:${guildId}:${eventId}`;

class EventError extends Error {
  constructor(message) {
    super(message);
    this.name = "EventError";
  }
}

/**
 * Work out the start and end of an event and validate the window.
 *
 * Pure so the time arithmetic is testable without touching Discord.
 *
 * @param {{startInMs: number, durationMs?: number|null, now?: number}} input
 * @returns {{startsAt: Date, endsAt: Date|null}}
 */
function resolveWindow({ startInMs, durationMs = null, now = Date.now() }) {
  if (!Number.isFinite(startInMs)) throw new EventError("Provide when the event starts, e.g. `2h` or `3d`.");
  if (startInMs < MIN_LEAD_MS) throw new EventError("The event must start at least a minute from now.");
  if (startInMs > MAX_LEAD_MS) throw new EventError("The event cannot start more than 30 days from now.");

  if (durationMs !== null && durationMs !== undefined) {
    if (!Number.isFinite(durationMs)) throw new EventError("Provide a duration such as `90m` or `3h`.");
    if (durationMs < MIN_LEAD_MS) throw new EventError("The event must last at least a minute.");
    if (durationMs > MAX_DURATION_MS) throw new EventError("The event cannot last longer than 30 days.");
  }

  const startsAt = new Date(now + startInMs);
  const endsAt = durationMs ? new Date(startsAt.getTime() + durationMs) : null;

  return { startsAt, endsAt };
}

/**
 * Create a native Discord scheduled event.
 *
 * Native events give members the RSVP list, the notification and the calendar
 * entry for free; the bot only adds the reminder and the announcement.
 *
 * @param {{guild: import('discord.js').Guild, name: string, description?: string, startsAt: Date, endsAt?: Date|null, channel?: object|null, location?: string|null}} input
 */
async function createEvent({ guild, name, description, startsAt, endsAt, channel = null, location = null }) {
  if (!guild.members.me.permissions.has("ManageEvents")) {
    throw new EventError("I need the `Manage Events` permission.");
  }

  const trimmedName = String(name || "").trim();
  if (trimmedName.length < 2 || trimmedName.length > 100) {
    throw new EventError("The event name must be between 2 and 100 characters.");
  }

  if (!channel && !location) {
    throw new EventError("Give the event a voice channel or an external location.");
  }
  if (location && !endsAt) {
    throw new EventError("An event at an external location needs a duration.");
  }

  const payload = {
    name: trimmedName,
    description: description ? String(description).slice(0, 1000) : undefined,
    scheduledStartTime: startsAt,
    scheduledEndTime: endsAt || undefined,
    privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
    entityType: channel ? GuildScheduledEventEntityType.Voice : GuildScheduledEventEntityType.External,
    channel: channel || undefined,
    entityMetadata: location ? { location: String(location).slice(0, 100) } : undefined,
  };

  return guild.scheduledEvents.create(payload);
}

/**
 * @param {{guildId: string, eventId: string, channelId: string, remindAt: Date, mention?: string|null}} input
 */
function scheduleReminder({ guildId, eventId, channelId, remindAt, mention = null }) {
  return scheduleTask({
    type: TASK_TYPE,
    guildId,
    runAt: remindAt,
    dedupeKey: dedupeKey(guildId, eventId),
    payload: { eventId, channelId, mention },
  });
}

/**
 * @param {string} guildId
 * @param {string} eventId
 */
function cancelReminder(guildId, eventId) {
  return cancelTasks({ dedupeKey: dedupeKey(guildId, eventId) });
}

/**
 * @param {import('discord.js').GuildScheduledEvent} event
 */
function buildEventEmbed(event) {
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLORS.BOT_EMBED)
    .setTitle(event.name)
    .setURL(event.url)
    .setDescription(event.description || null)
    .addFields({
      name: "Starts",
      value: `${time(event.scheduledStartAt, "F")} (${time(event.scheduledStartAt, "R")})`,
    });

  if (event.scheduledEndAt) {
    embed.addFields({ name: "Ends", value: time(event.scheduledEndAt, "F"), inline: true });
  }

  const where = event.channel ? `<#${event.channelId}>` : event.entityMetadata?.location;
  if (where) embed.addFields({ name: "Where", value: where, inline: true });

  if (typeof event.userCount === "number") {
    embed.setFooter({ text: `${event.userCount} interested` });
  }

  return embed;
}

/**
 * Scheduler handler: ping the configured channel shortly before the event starts.
 * @param {object} payload
 * @param {{client: import('discord.js').Client, task: object}} context
 */
async function handleReminder(payload, { client, task }) {
  const guild = client.guilds.cache.get(task.guild_id) || (await client.guilds.fetch(task.guild_id).catch(() => null));
  if (!guild) return;

  const event = await guild.scheduledEvents.fetch(payload.eventId).catch(() => null);
  // Cancelled or already finished events are simply dropped.
  if (!event || ["COMPLETED", "CANCELED"].includes(String(event.status))) return;

  const channel = guild.channels.cache.get(payload.channelId);
  if (!channel?.isTextBased()) return;
  if (!channel.permissionsFor(guild.members.me)?.has(["ViewChannel", "SendMessages", "EmbedLinks"])) return;

  await channel
    .send({
      content: [payload.mention, `**${event.name}** starts ${time(event.scheduledStartAt, "R")}`]
        .filter(Boolean)
        .join(" "),
      embeds: [buildEventEmbed(event)],
    })
    .catch(() => {});
}

/**
 * @param {import('@src/services/scheduler/Scheduler').Scheduler} scheduler
 */
function register(scheduler) {
  scheduler.register(TASK_TYPE, handleReminder);
  return scheduler;
}

module.exports = {
  EventError,
  MAX_DURATION_MS,
  MAX_LEAD_MS,
  MIN_LEAD_MS,
  TASK_TYPE,
  buildEventEmbed,
  cancelReminder,
  createEvent,
  handleReminder,
  register,
  resolveWindow,
  scheduleReminder,
};
