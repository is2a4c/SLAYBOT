const DashboardAuditLog = require("@schemas/DashboardAuditLog");

/**
 * Appends one entry to the dashboard audit trail. Never throws into the caller's
 * request flow - a logging failure must not block or roll back the action that
 * already happened (e.g. a Discord ban), it's just reported.
 * @param {object} entry
 * @param {string} entry.actorId
 * @param {string} entry.actorTag
 * @param {string} entry.action
 * @param {string|null} [entry.guildId]
 * @param {string|null} [entry.targetType]
 * @param {string|null} [entry.targetId]
 * @param {object|null} [entry.before]
 * @param {object|null} [entry.after]
 * @param {string|null} [entry.reason]
 * @param {import('@helpers/Logger')} [logger]
 */
async function logAudit(entry, logger = require("@helpers/Logger")) {
  try {
    await DashboardAuditLog.create({
      actorId: entry.actorId,
      actorTag: entry.actorTag,
      action: entry.action,
      guildId: entry.guildId || null,
      targetType: entry.targetType || null,
      targetId: entry.targetId || null,
      before: entry.before ?? null,
      after: entry.after ?? null,
      reason: entry.reason || null,
    });
  } catch (ex) {
    logger.error(`Failed to write dashboard audit log entry (action=${entry.action})`, ex);
  }
}

/**
 * @param {object} filter
 * @param {string|null} [filter.guildId]
 * @param {number} [limit]
 */
async function listAuditLog({ guildId = null, limit = 100 } = {}) {
  const query = guildId ? { guildId } : {};
  return DashboardAuditLog.find(query)
    .sort({ created_at: -1 })
    .limit(Math.min(500, Math.max(1, limit)))
    .lean();
}

module.exports = { logAudit, listAuditLog };
