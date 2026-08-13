const { EmbedBuilder } = require("discord.js");
const { EMBED_COLORS } = require("@root/config");
const { scheduleTask, cancelTasks } = require("@schemas/ScheduledTask");
const { findBirthdaysOn, markAnnounced } = require("@schemas/Birthday");
// Accessed through the module object so tests can stub the settings lookup.
const guildSchema = require("@schemas/Guild");
const { grantTempRole } = require("@src/services/roles/TempRoles");

const TASK_TYPE = "BIRTHDAY_ANNOUNCE";
const DEFAULT_MESSAGE = "🎉 Happy birthday {member}!";
const dedupeKey = (guildId) => `${TASK_TYPE}:${guildId}`;

/**
 * Next announcement moment for a guild: the configured hour, in the guild's
 * UTC offset, on the next day that has not passed yet.
 *
 * @param {{hour?: number, utcOffset?: number, from?: Date}} input
 * @returns {Date}
 */
function nextRunAt({ hour = 9, utcOffset = 0, from = new Date() } = {}) {
  const localNow = new Date(from.getTime() + utcOffset * 60 * 60 * 1000);

  const localTarget = Date.UTC(localNow.getUTCFullYear(), localNow.getUTCMonth(), localNow.getUTCDate(), hour, 0, 0, 0);

  const candidate = localTarget - utcOffset * 60 * 60 * 1000;
  if (candidate > from.getTime()) return new Date(candidate);

  return new Date(candidate + 24 * 60 * 60 * 1000);
}

/**
 * @param {{guildId: string, hour?: number, utcOffset?: number, from?: Date}} input
 */
function scheduleNextAnnouncement({ guildId, hour, utcOffset, from }) {
  return scheduleTask({
    type: TASK_TYPE,
    guildId,
    runAt: nextRunAt({ hour, utcOffset, from }),
    dedupeKey: dedupeKey(guildId),
    payload: { hour: hour ?? 9, utcOffset: utcOffset ?? 0 },
  });
}

/**
 * @param {string} guildId
 */
function cancelAnnouncements(guildId) {
  return cancelTasks({ dedupeKey: dedupeKey(guildId) });
}

/**
 * @param {string} template
 * @param {import('discord.js').GuildMember} member
 * @param {number|null} age
 */
function renderMessage(template, member, age) {
  return (template || DEFAULT_MESSAGE)
    .replace(/{member}/g, member.toString())
    .replace(/{name}/g, member.displayName)
    .replace(/{server}/g, member.guild.name)
    .replace(/{age}/g, age === null ? "" : String(age))
    .trim();
}

/**
 * Scheduler handler: announce today's birthdays and re-arm for tomorrow.
 * @param {object} payload
 * @param {{client: import('discord.js').Client, task: object}} context
 */
async function handleAnnouncement(payload, { client, task }) {
  const guildId = task.guild_id;
  const guild = client.guilds.cache.get(guildId) || (await client.guilds.fetch(guildId).catch(() => null));

  // The guild is gone: stop re-arming.
  if (!guild) return;

  const settings = await guildSchema.getSettings(guild);
  const config = settings.birthdays || {};

  if (!config.enabled) return; // disabled since the task was scheduled

  const utcOffset = config.utc_offset || 0;
  const local = new Date(Date.now() + utcOffset * 60 * 60 * 1000);
  const day = local.getUTCDate();
  const month = local.getUTCMonth() + 1;
  const year = local.getUTCFullYear();

  try {
    const birthdays = await findBirthdaysOn({ guildId, day, month });
    const due = birthdays.filter((entry) => entry.last_announced_year !== year);

    if (due.length > 0) {
      const channel = config.channel_id ? guild.channels.cache.get(config.channel_id) : null;
      const announced = [];

      for (const entry of due) {
        const member = await guild.members.fetch(entry.user_id).catch(() => null);
        if (!member) continue;

        const age = entry.year ? year - entry.year : null;

        if (channel?.isTextBased() && channel.permissionsFor(guild.members.me)?.has(["SendMessages", "ViewChannel"])) {
          const embed = new EmbedBuilder()
            .setColor(config.color || EMBED_COLORS.BOT_EMBED)
            .setDescription(renderMessage(config.message, member, age))
            .setThumbnail(member.user.displayAvatarURL());
          await channel.send({ content: member.toString(), embeds: [embed] }).catch(() => {});
        }

        // Birthday role for 24 hours, using the same durable expiry as temp roles.
        if (config.role_id) {
          const role = guild.roles.cache.get(config.role_id);
          if (role) {
            await grantTempRole({
              member,
              role,
              durationMs: Math.min(168, Math.max(1, Number(config.role_duration_hours) || 24)) * 60 * 60 * 1000,
              reason: "Birthday",
            }).catch(() => {});
          }
        }

        announced.push(entry.user_id);
      }

      if (announced.length > 0) await markAnnounced(guildId, announced, year);
    }
  } finally {
    // Always re-arm, even when today's run failed halfway through.
    await scheduleNextAnnouncement({ guildId, hour: config.hour ?? 9, utcOffset });
  }
}

/**
 * @param {import('@src/services/scheduler/Scheduler').Scheduler} scheduler
 */
function register(scheduler) {
  scheduler.register(TASK_TYPE, handleAnnouncement);
  return scheduler;
}

module.exports = {
  TASK_TYPE,
  DEFAULT_MESSAGE,
  cancelAnnouncements,
  handleAnnouncement,
  nextRunAt,
  register,
  renderMessage,
  scheduleNextAnnouncement,
};
