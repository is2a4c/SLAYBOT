const { saveMemberRoles, getMemberRoles, clearMemberRoles } = require("@schemas/MemberRoles");

/**
 * Restore roles: snapshot a member's roles and nickname when they leave so a
 * rejoin puts them back where they were. Members who leave to dodge a mute get
 * it back too, which is the point.
 */

/**
 * Autoroles are a list, but older installs stored a single role id. Read both so
 * a server configured before the change keeps working.
 *
 * @param {string[]|string|null|undefined} value
 * @returns {string[]}
 */
function normalizeAutoRoles(value) {
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  return value ? [String(value)] : [];
}

const PRIVILEGED_PERMISSIONS = [
  "Administrator",
  "ManageGuild",
  "ManageRoles",
  "ManageChannels",
  "ManageWebhooks",
  "BanMembers",
  "KickMembers",
  "ModerateMembers",
  "ManageMessages",
  "MentionEveryone",
];

/**
 * @param {import('discord.js').Role} role
 */
function isPrivileged(role) {
  return PRIVILEGED_PERMISSIONS.some((permission) => role.permissions.has(permission));
}

/**
 * Narrow a snapshot down to roles the bot may hand back right now.
 * @param {import('discord.js').Guild} guild
 * @param {string[]} roleIds
 * @param {{includePrivileged?: boolean}} options
 * @returns {string[]}
 */
function filterRestorable(guild, roleIds, { includePrivileged = false } = {}) {
  const highest = guild.members.me?.roles?.highest?.position ?? 0;

  return (roleIds || []).filter((roleId) => {
    const role = guild.roles.cache.get(roleId);
    if (!role || role.managed || role.id === guild.id) return false;
    if (highest <= role.position) return false;
    // Dangerous roles are not silently handed back on rejoin unless allowed.
    if (!includePrivileged && isPrivileged(role)) return false;
    return true;
  });
}

/**
 * Hand a new member every autorole the bot is actually able to give.
 *
 * @param {import('discord.js').GuildMember} member
 * @param {object} settings guild settings document
 * @returns {Promise<string[]>} roles that were given
 */
async function applyAutoRoles(member, settings) {
  const wanted = normalizeAutoRoles(settings?.autorole);
  if (!wanted.length) return [];

  const guild = member.guild;
  if (!guild.members.me?.permissions.has("ManageRoles")) return [];

  const highest = guild.members.me.roles.highest.position;
  const giveable = wanted.filter((roleId) => {
    const role = guild.roles.cache.get(roleId);
    return Boolean(role) && !role.managed && role.id !== guild.id && highest > role.position;
  });

  if (!giveable.length) return [];

  return member.roles
    .add(giveable, "Autorole")
    .then(() => giveable)
    .catch((ex) => {
      member.client.logger?.error("autorole: failed to give roles", ex);
      return [];
    });
}

/**
 * @param {import('discord.js').GuildMember} member
 * @param {object} settings guild settings document
 */
async function saveRoles(member, settings) {
  const wantsRoles = Boolean(settings?.restore_roles?.enabled);
  const wantsNickname = Boolean(settings?.control_center?.common?.restore_nickname);
  if (!wantsRoles && !wantsNickname) return null;
  if (member.user?.bot) return null;

  return saveMemberRoles(member, settings.restore_roles?.retention_days, {
    nickname: wantsNickname ? member.nickname || null : null,
  }).catch((ex) => {
    member.client.logger?.error("restoreRoles: failed to store snapshot", ex);
    return null;
  });
}

/**
 * Roles from `snapshot`, applied and reported - never fetches or clears the
 * snapshot itself, since nickname restoration may still need it.
 *
 * @param {import('discord.js').GuildMember} member
 * @param {object} settings guild settings document
 * @param {{roles?: string[]}|null} snapshot
 * @returns {Promise<string[]>} roles that were restored
 */
async function restoreRoles(member, settings, snapshot) {
  if (!settings?.restore_roles?.enabled) return [];
  if (member.user?.bot) return [];

  const guild = member.guild;
  const me = guild.members.me;
  if (!me?.permissions.has("ManageRoles")) return [];
  if (!snapshot?.roles?.length) return [];

  const restorable = filterRestorable(guild, snapshot.roles, {
    includePrivileged: settings.restore_roles.include_privileged,
  });
  if (restorable.length === 0) return [];

  try {
    await member.roles.add(restorable, "Restoring roles from previous membership");
    return restorable;
  } catch (ex) {
    member.client.logger?.error("restoreRoles: failed to restore roles", ex);
    return [];
  }
}

/**
 * The nickname from `snapshot`, applied - independent of role restoration,
 * so a server can turn either on without the other.
 *
 * @param {import('discord.js').GuildMember} member
 * @param {object} settings guild settings document
 * @param {{nickname?: string|null}|null} snapshot
 * @returns {Promise<string|null>} the nickname that was restored
 */
async function restoreNickname(member, settings, snapshot) {
  if (!settings?.control_center?.common?.restore_nickname) return null;
  if (member.user?.bot) return null;
  if (!snapshot?.nickname) return null;

  const me = member.guild.members.me;
  if (!me?.permissions.has("ManageNicknames")) return null;
  if (me.roles.highest.position <= member.roles.highest.position) return null;

  try {
    await member.setNickname(snapshot.nickname, "Restoring nickname from previous membership");
    return snapshot.nickname;
  } catch (ex) {
    member.client.logger?.error("restoreNickname: failed to restore nickname", ex);
    return null;
  }
}

/**
 * Read a rejoining member's snapshot once and apply whichever of roles and
 * nickname this server wants back, then consume the snapshot - a single read
 * and a single clear, so restoring one does not blind the other to it.
 *
 * @param {import('discord.js').GuildMember} member
 * @param {object} settings guild settings document
 * @returns {Promise<{rolesRestored: string[], nicknameRestored: string|null}>}
 */
async function restoreMembership(member, settings) {
  const empty = { rolesRestored: [], nicknameRestored: null };
  const wantsRoles = Boolean(settings?.restore_roles?.enabled);
  const wantsNickname = Boolean(settings?.control_center?.common?.restore_nickname);
  if (!wantsRoles && !wantsNickname) return empty;
  if (member.user?.bot) return empty;

  const guild = member.guild;
  const snapshot = await getMemberRoles(guild.id, member.id).catch(() => null);
  if (!snapshot) return empty;

  const rolesRestored = await restoreRoles(member, settings, snapshot);
  const nicknameRestored = await restoreNickname(member, settings, snapshot);

  await clearMemberRoles(guild.id, member.id).catch(() => {});
  return { rolesRestored, nicknameRestored };
}

module.exports = {
  applyAutoRoles,
  filterRestorable,
  normalizeAutoRoles,
  restoreMembership,
  restoreNickname,
  restoreRoles,
  saveRoles,
};
