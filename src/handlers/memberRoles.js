const { saveMemberRoles, getMemberRoles, clearMemberRoles } = require("@schemas/MemberRoles");

/**
 * Restore roles: snapshot a member's roles when they leave so a rejoin puts them
 * back where they were. Members who leave to dodge a mute get it back too, which
 * is the point.
 */
module.exports = {
  filterRestorable,

  /**
   * @param {import('discord.js').GuildMember} member
   * @param {object} settings guild settings document
   */
  async saveRoles(member, settings) {
    if (!settings?.restore_roles?.enabled) return null;
    if (member.user?.bot) return null;

    return saveMemberRoles(member, settings.restore_roles.retention_days).catch((ex) => {
      member.client.logger?.error("restoreRoles: failed to store snapshot", ex);
      return null;
    });
  },

  /**
   * @param {import('discord.js').GuildMember} member
   * @param {object} settings guild settings document
   * @returns {Promise<string[]>} roles that were restored
   */
  async restoreRoles(member, settings) {
    if (!settings?.restore_roles?.enabled) return [];
    if (member.user?.bot) return [];

    const guild = member.guild;
    const me = guild.members.me;
    if (!me?.permissions.has("ManageRoles")) return [];

    const snapshot = await getMemberRoles(guild.id, member.id).catch(() => null);
    if (!snapshot?.roles?.length) return [];

    const restorable = filterRestorable(guild, snapshot.roles, {
      includePrivileged: settings.restore_roles.include_privileged,
    });

    if (restorable.length === 0) {
      await clearMemberRoles(guild.id, member.id).catch(() => {});
      return [];
    }

    try {
      await member.roles.add(restorable, "Restoring roles from previous membership");
    } catch (ex) {
      member.client.logger?.error("restoreRoles: failed to restore roles", ex);
      return [];
    }

    await clearMemberRoles(guild.id, member.id).catch(() => {});
    return restorable;
  },
};

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
