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
function auditQuery({ guildId = null, action = null, actorId = null, targetType = null, search = null } = {}) {
  const query = guildId ? { guildId } : {};
  if (action) query.action = String(action).slice(0, 100);
  if (actorId && /^\d{17,20}$/.test(String(actorId))) query.actorId = String(actorId);
  if (targetType) query.targetType = String(targetType).slice(0, 100);
  const term = String(search || "")
    .trim()
    .slice(0, 80);
  if (term) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(escaped, "i");
    query.$or = [{ actorTag: pattern }, { targetId: pattern }, { reason: pattern }, { action: pattern }];
  }
  return query;
}

async function listAuditLog({ guildId = null, action, actorId, targetType, search, limit = 100 } = {}) {
  const query = auditQuery({ guildId, action, actorId, targetType, search });
  return DashboardAuditLog.find(query)
    .sort({ created_at: -1 })
    .limit(Math.min(500, Math.max(1, limit)))
    .lean();
}

function csvCell(value) {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function auditCsv(entries) {
  const rows = [["time", "action", "actor_tag", "actor_id", "target_type", "target_id", "reason"]];
  for (const entry of entries) {
    rows.push([
      new Date(entry.created_at).toISOString(),
      entry.action,
      entry.actorTag,
      entry.actorId,
      entry.targetType,
      entry.targetId,
      entry.reason,
    ]);
  }
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
}

module.exports = { auditCsv, auditQuery, logAudit, listAuditLog };
