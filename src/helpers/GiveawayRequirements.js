const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_BONUS_ENTRIES = 10;

/**
 * Entry requirements for a giveaway.
 *
 * @typedef {Object} GiveawayRequirements
 * @property {string[]} allowedRoles roles that may enter (empty = everyone)
 * @property {string[]} blockedRoles roles that may never enter
 * @property {number} minLevel minimum XP level
 * @property {number} minInvites minimum effective invites
 * @property {number} minAccountAgeDays minimum Discord account age
 * @property {number} minServerDays minimum time on the server
 * @property {{roleId: string, entries: number}|null} bonus extra entries for a role
 */

/**
 * @param {object} [input]
 * @returns {GiveawayRequirements}
 */
function normalizeRequirements(input = {}) {
  const positive = (value) => (Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);

  return {
    allowedRoles: (input.allowedRoles || []).filter(Boolean),
    blockedRoles: (input.blockedRoles || []).filter(Boolean),
    minLevel: positive(input.minLevel),
    minInvites: positive(input.minInvites),
    minAccountAgeDays: positive(input.minAccountAgeDays),
    minServerDays: positive(input.minServerDays),
    bonus:
      input.bonus?.roleId && positive(input.bonus.entries) > 0
        ? { roleId: input.bonus.roleId, entries: Math.min(MAX_BONUS_ENTRIES, positive(input.bonus.entries)) }
        : null,
  };
}

/**
 * Decide whether a member may enter, and why not.
 *
 * Pure so every rule is testable without Discord: the caller supplies the
 * member's roles, level, invites and timestamps.
 *
 * @param {{requirements: GiveawayRequirements, member: {roleIds: string[], level?: number, invites?: number, accountCreatedAt?: number|Date, joinedAt?: number|Date}, now?: number}} input
 * @returns {{eligible: boolean, reasons: string[]}}
 */
function evaluateEligibility({ requirements, member, now = Date.now() }) {
  const rules = normalizeRequirements(requirements);
  const roleIds = new Set(member?.roleIds || []);
  const reasons = [];

  if (rules.blockedRoles.some((roleId) => roleIds.has(roleId))) {
    reasons.push("holds a blocked role");
  }

  if (rules.allowedRoles.length > 0 && !rules.allowedRoles.some((roleId) => roleIds.has(roleId))) {
    reasons.push("missing a required role");
  }

  if (rules.minLevel > 0 && (member?.level ?? 0) < rules.minLevel) {
    reasons.push(`needs level ${rules.minLevel}`);
  }

  if (rules.minInvites > 0 && (member?.invites ?? 0) < rules.minInvites) {
    reasons.push(`needs ${rules.minInvites} invites`);
  }

  if (rules.minAccountAgeDays > 0) {
    const created = member?.accountCreatedAt ? new Date(member.accountCreatedAt).getTime() : null;
    if (created === null || now - created < rules.minAccountAgeDays * DAY_MS) {
      reasons.push(`account must be ${rules.minAccountAgeDays} days old`);
    }
  }

  if (rules.minServerDays > 0) {
    const joined = member?.joinedAt ? new Date(member.joinedAt).getTime() : null;
    if (joined === null || now - joined < rules.minServerDays * DAY_MS) {
      reasons.push(`must be on the server for ${rules.minServerDays} days`);
    }
  }

  return { eligible: reasons.length === 0, reasons };
}

/**
 * Extra entries a member earns from the bonus role.
 * @param {{requirements: GiveawayRequirements, roleIds: string[]}} input
 * @returns {number}
 */
function calculateBonusEntries({ requirements, roleIds }) {
  const rules = normalizeRequirements(requirements);
  if (!rules.bonus) return 0;
  return (roleIds || []).includes(rules.bonus.roleId) ? rules.bonus.entries : 0;
}

/**
 * Human-readable requirement list for the giveaway message.
 * @param {GiveawayRequirements} requirements
 * @returns {string[]}
 */
function describeRequirements(requirements) {
  const rules = normalizeRequirements(requirements);
  const lines = [];

  if (rules.allowedRoles.length) lines.push(`Requires ${rules.allowedRoles.map((id) => `<@&${id}>`).join(" or ")}`);
  if (rules.blockedRoles.length) lines.push(`Excluded: ${rules.blockedRoles.map((id) => `<@&${id}>`).join(", ")}`);
  if (rules.minLevel) lines.push(`Level ${rules.minLevel}+`);
  if (rules.minInvites) lines.push(`${rules.minInvites}+ invites`);
  if (rules.minAccountAgeDays) lines.push(`Account older than ${rules.minAccountAgeDays} days`);
  if (rules.minServerDays) lines.push(`On the server for ${rules.minServerDays}+ days`);
  if (rules.bonus) lines.push(`<@&${rules.bonus.roleId}> gets ${rules.bonus.entries}x entries`);

  return lines;
}

/**
 * Does this requirement set need anything beyond roles? Level and invites cost a
 * database read per entry, so the caller can skip that work when they are unused.
 * @param {GiveawayRequirements} requirements
 */
function needsMemberData(requirements) {
  const rules = normalizeRequirements(requirements);
  return rules.minLevel > 0 || rules.minInvites > 0;
}

module.exports = {
  DAY_MS,
  MAX_BONUS_ENTRIES,
  calculateBonusEntries,
  describeRequirements,
  evaluateEligibility,
  needsMemberData,
  normalizeRequirements,
};
