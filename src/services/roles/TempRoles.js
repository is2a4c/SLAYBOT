const { scheduleTask, cancelTasks, listTasks } = require("@schemas/ScheduledTask");

const TASK_TYPE = "TEMP_ROLE_REMOVE";
const MIN_DURATION_MS = 10_000;
const MAX_DURATION_MS = 365 * 24 * 60 * 60 * 1000;

const dedupeKey = (guildId, userId, roleId) => `${TASK_TYPE}:${guildId}:${userId}:${roleId}`;

class TempRoleError extends Error {
  constructor(message) {
    super(message);
    this.name = "TempRoleError";
  }
}

/**
 * @param {number} durationMs
 */
function assertDuration(durationMs) {
  if (!Number.isFinite(durationMs)) throw new TempRoleError("Provide a duration such as `2h`, `30m` or `7d`.");
  if (durationMs < MIN_DURATION_MS) throw new TempRoleError("The duration must be at least 10 seconds.");
  if (durationMs > MAX_DURATION_MS) throw new TempRoleError("The duration cannot exceed one year.");
  return durationMs;
}

/**
 * Give a member a role that expires on its own.
 *
 * The expiry lives in the scheduler collection, so it survives restarts and is
 * re-armed rather than duplicated when the same role is granted again.
 *
 * @param {{member: import('discord.js').GuildMember, role: import('discord.js').Role, durationMs: number, reason?: string, moderatorId?: string}} input
 */
async function grantTempRole({ member, role, durationMs, reason, moderatorId }) {
  assertDuration(durationMs);

  const guild = member.guild;
  if (role.id === guild.id) throw new TempRoleError("`@everyone` cannot be granted temporarily.");
  if (role.managed) throw new TempRoleError(`${role.name} is managed by an integration.`);
  if (!guild.members.me.permissions.has("ManageRoles"))
    throw new TempRoleError("I need the `Manage Roles` permission.");
  if (guild.members.me.roles.highest.position <= role.position) {
    throw new TempRoleError(`${role.name} is above my highest role, so I cannot assign it.`);
  }

  const expiresAt = new Date(Date.now() + durationMs);
  const alreadyHeld = member.roles.cache.has(role.id);

  if (!alreadyHeld) {
    await member.roles.add(role, reason ? `Temporary role: ${reason}` : "Temporary role");
  }

  await scheduleTask({
    type: TASK_TYPE,
    guildId: guild.id,
    runAt: expiresAt,
    dedupeKey: dedupeKey(guild.id, member.id, role.id),
    payload: {
      userId: member.id,
      roleId: role.id,
      reason: reason || null,
      moderatorId: moderatorId || null,
    },
  });

  return { expiresAt, alreadyHeld };
}

/**
 * Drop the pending expiry (and optionally the role itself).
 * @param {{guildId: string, userId: string, roleId: string}} input
 */
function cancelTempRole({ guildId, userId, roleId }) {
  return cancelTasks({ dedupeKey: dedupeKey(guildId, userId, roleId) });
}

/**
 * @param {{guildId: string, userId?: string}} filter
 */
function listTempRoles({ guildId, userId }) {
  return listTasks({
    type: TASK_TYPE,
    guildId,
    payloadMatch: userId ? { userId } : undefined,
  });
}

/**
 * Scheduler handler: strip the role once the lease is up.
 * @param {object} payload
 * @param {{client: import('discord.js').Client, task: object}} context
 */
async function handleExpiry(payload, { client, task }) {
  const guild = client.guilds.cache.get(task.guild_id) || (await client.guilds.fetch(task.guild_id).catch(() => null));
  if (!guild) return; // bot was removed - nothing to clean up

  const member = await guild.members.fetch(payload.userId).catch(() => null);
  if (!member) return; // member left; role is gone with them

  const role = guild.roles.cache.get(payload.roleId);
  if (!role || !member.roles.cache.has(role.id)) return;

  await member.roles.remove(role, "Temporary role expired");
}

/**
 * @param {import('@src/services/scheduler/Scheduler').Scheduler} scheduler
 */
function register(scheduler) {
  scheduler.register(TASK_TYPE, handleExpiry);
  return scheduler;
}

module.exports = {
  TASK_TYPE,
  MIN_DURATION_MS,
  MAX_DURATION_MS,
  TempRoleError,
  assertDuration,
  cancelTempRole,
  grantTempRole,
  handleExpiry,
  listTempRoles,
  register,
};
