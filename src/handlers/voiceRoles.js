/**
 * Voice roles: hand a role to whoever is currently in a voice channel and take
 * it back when they leave. Useful for a "in voice" ping role or per-channel
 * text access.
 */

/**
 * Roles configured for a channel, plus the guild-wide "any voice channel" role.
 * @param {object} settings guild settings document
 * @param {string|null} channelId
 * @returns {string[]}
 */
function rolesForChannel(settings, channelId) {
  const config = settings?.voice_roles;
  if (!config?.enabled) return [];

  const roles = new Set();
  if (config.default_role && channelId) roles.add(config.default_role);

  for (const entry of config.channels || []) {
    if (entry.channel_id === channelId && entry.role_id) roles.add(entry.role_id);
  }

  return [...roles];
}

/**
 * Every role the voice-role feature owns in this guild. Anything in here that is
 * not earned by the member's current channel gets removed.
 * @param {object} settings
 * @returns {string[]}
 */
function managedRoles(settings) {
  const config = settings?.voice_roles;
  if (!config?.enabled) return [];

  const roles = new Set();
  if (config.default_role) roles.add(config.default_role);
  for (const entry of config.channels || []) {
    if (entry.role_id) roles.add(entry.role_id);
  }
  return [...roles];
}

/**
 * @param {{settings: object, memberRoleIds: string[]|Set<string>, channelId: string|null}} input
 * @returns {{add: string[], remove: string[]}}
 */
function resolveVoiceRoleChanges({ settings, memberRoleIds, channelId }) {
  const current = memberRoleIds instanceof Set ? memberRoleIds : new Set(memberRoleIds || []);
  const earned = new Set(rolesForChannel(settings, channelId));

  const add = [...earned].filter((roleId) => !current.has(roleId));
  const remove = managedRoles(settings).filter((roleId) => !earned.has(roleId) && current.has(roleId));

  return { add, remove };
}

module.exports = {
  managedRoles,
  resolveVoiceRoleChanges,
  rolesForChannel,

  /**
   * @param {import('discord.js').VoiceState} oldState
   * @param {import('discord.js').VoiceState} newState
   * @param {object} settings
   */
  async handleVoiceStateUpdate(oldState, newState, settings) {
    if (!settings?.voice_roles?.enabled) return;

    const member = newState.member || oldState.member;
    if (!member || member.user.bot) return;

    const guild = member.guild;
    const me = guild.members.me;
    if (!me?.permissions.has("ManageRoles")) return;

    const { add, remove } = resolveVoiceRoleChanges({
      settings,
      memberRoleIds: member.roles.cache.map((role) => role.id),
      channelId: newState.channelId || null,
    });

    const assignable = (roleId) => {
      const role = guild.roles.cache.get(roleId);
      return role && !role.managed && me.roles.highest.position > role.position;
    };

    const toAdd = add.filter(assignable);
    const toRemove = remove.filter(assignable);

    if (toRemove.length) await member.roles.remove(toRemove, "Voice role").catch(() => {});
    if (toAdd.length) await member.roles.add(toAdd, "Voice role").catch(() => {});
  },
};
