const { scheduleTask, listTasks } = require("@schemas/ScheduledTask");
const { getMember, model: memberModel } = require("@schemas/Member");
const { model: modLogModel } = require("@schemas/ModLog");
const { getSettings } = require("@schemas/Guild");
const { warningExpiryDays } = require("./policy");

const TASK_TYPE = "WARNING_EXPIRY_SWEEP";
const SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const dedupeKey = (guildId) => `${TASK_TYPE}:${guildId}`;

/**
 * A warning only ever decays, never resets outright on its own - a member's
 * active count is however many of their WARN log entries are still within
 * the server's expiry window. Recomputed from the log rather than a
 * per-warning timestamp on the member document, since the log already has
 * exactly that.
 *
 * @param {string} guildId
 * @param {number} days
 */
async function decayExpiredWarnings(guildId, days) {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const stale = await memberModel.find({ guild_id: guildId, warnings: { $gt: 0 } }).lean();

  for (const doc of stale) {
    const activeCount = await modLogModel.countDocuments({
      guild_id: guildId,
      member_id: doc.member_id,
      type: "WARN",
      created_at: { $gte: cutoff },
    });

    if (activeCount < doc.warnings) {
      const memberDb = await getMember(guildId, doc.member_id);
      memberDb.warnings = activeCount;
      await memberDb.save();
    }
  }
}

/**
 * Arrange for this guild's warnings to be swept a day from now, unless a
 * sweep is already pending. Meant to be called whenever a warning is
 * issued, so expiry starts working the moment a server actually has one.
 *
 * @param {string} guildId
 */
async function ensureScheduled(guildId) {
  const existing = await listTasks({ type: TASK_TYPE, guildId, limit: 1 });
  if (existing.length > 0) return;

  await scheduleTask({
    type: TASK_TYPE,
    guildId,
    runAt: new Date(Date.now() + SWEEP_INTERVAL_MS),
    dedupeKey: dedupeKey(guildId),
  });
}

/**
 * Scheduler handler: decay this guild's warnings, then re-arm for tomorrow -
 * but only while the server still wants expiry. A server that turns it off
 * simply stops getting swept; `ensureScheduled` picks it back up the next
 * time a warning is actually issued.
 *
 * @param {object} payload
 * @param {{client: import('discord.js').Client, task: object}} context
 */
async function handleSweep(payload, { client, task }) {
  const guildId = task.guild_id;
  const guild = client.guilds.cache.get(guildId) || (await client.guilds.fetch(guildId).catch(() => null));
  if (!guild) return;

  const settings = await getSettings(guild);
  const days = warningExpiryDays(settings);
  if (!(days > 0)) return;

  await decayExpiredWarnings(guildId, days);
  await scheduleTask({
    type: TASK_TYPE,
    guildId,
    runAt: new Date(Date.now() + SWEEP_INTERVAL_MS),
    dedupeKey: dedupeKey(guildId),
  });
}

/**
 * @param {import('@src/services/scheduler/Scheduler').Scheduler} scheduler
 */
function register(scheduler) {
  scheduler.register(TASK_TYPE, handleSweep);
  return scheduler;
}

module.exports = {
  SWEEP_INTERVAL_MS,
  TASK_TYPE,
  decayExpiredWarnings,
  ensureScheduled,
  handleSweep,
  register,
};
