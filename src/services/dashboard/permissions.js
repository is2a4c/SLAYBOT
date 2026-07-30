// Atomic, additive permission strings. Stage 1 only wires up the subset actually
// used by the panels built so far - more will be added as later sections of the
// dashboard concept are implemented, following the same naming convention.
const ATOMIC_PERMISSIONS = [
  "guilds.view",
  "guilds.manage",
  "members.moderate",
  "automod.edit",
  "audit.view",
  "audit.export",
  "staff.manage",
  "smartinvites.manage",
  "diagnostics.run",
  "config.edit",
];

// Stage 1 ships two hard-coded roles instead of a role builder (that CRUD is a
// later-stage feature). `admin` gets every atomic permission that exists today.
const ROLE_PRESETS = {
  moderator: ["guilds.view", "members.moderate", "automod.edit", "diagnostics.run", "audit.view"],
  admin: [...ATOMIC_PERMISSIONS],
};

/**
 * @param {object} opts
 * @param {boolean} opts.isOwner - true if the user's id is in config.OWNER_IDS
 * @param {{role: string}|null} opts.staffAccount - StaffAccount document, if any
 * @returns {Set<string>}
 */
function resolveEffectivePermissions({ isOwner, staffAccount }) {
  if (isOwner) return new Set(ATOMIC_PERMISSIONS);
  if (!staffAccount || !ROLE_PRESETS[staffAccount.role]) return new Set();
  return new Set(ROLE_PRESETS[staffAccount.role]);
}

module.exports = { ATOMIC_PERMISSIONS, ROLE_PRESETS, resolveEffectivePermissions };
