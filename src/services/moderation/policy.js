/**
 * A server's own rules for its moderation team - who counts as a moderator,
 * whether role position still gates who can act on whom, how a mute is
 * actually carried out, and how long a warning stays on someone's record.
 *
 * Read here and nowhere else, so ModUtils, the command cooldown check,
 * automod's bypass, the reaction-block listener and the channel-create hook
 * all agree on the same settings.
 */

const MUTE_MODES = ["TIMEOUT", "ROLE", "BOTH"];
const MUTE_SCOPES = ["ALL", "TEXT", "VOICE"];
const DEFAULT_WARNING_EXPIRY_DAYS = 30;

/**
 * @param {object} settings guild settings document
 * @returns {object|null}
 */
function moderationConfig(settings) {
  return settings?.control_center?.moderation || null;
}

/**
 * @param {object} settings
 * @returns {string[]}
 */
function moderatorRoleIds(settings) {
  return moderationConfig(settings)?.moderator_roles || [];
}

/**
 * @param {object} settings
 * @param {import('discord.js').GuildMember} [member]
 * @returns {boolean}
 */
function isModerator(settings, member) {
  const roles = moderatorRoleIds(settings);
  if (!roles.length) return false;
  return roles.some((roleId) => Boolean(member?.roles?.cache?.has(roleId)));
}

/**
 * @param {object} settings
 * @returns {boolean} whether a listed moderator role is exempt from command cooldowns
 */
function cooldownExemptEnabled(settings) {
  return moderationConfig(settings)?.cooldown_exempt !== false;
}

/**
 * @param {object} settings
 * @param {import('discord.js').GuildMember} [member]
 * @returns {boolean}
 */
function isCooldownExemptModerator(settings, member) {
  if (!member) return false;
  if (!cooldownExemptEnabled(settings)) return false;
  return isModerator(settings, member);
}

/**
 * @param {object} settings
 * @returns {boolean} whether an issuer must outrank their target to act on them
 */
function respectsRoleHierarchy(settings) {
  return moderationConfig(settings)?.respect_role_hierarchy !== false;
}

/**
 * @param {object} settings
 * @returns {number} days a warning stays active before it decays, 0 = never
 */
function warningExpiryDays(settings) {
  const value = Number(moderationConfig(settings)?.warning_expiry_days);
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_WARNING_EXPIRY_DAYS;
}

/**
 * @param {object} settings
 * @returns {"TIMEOUT"|"ROLE"|"BOTH"}
 */
function muteMode(settings) {
  const value = moderationConfig(settings)?.mute_mode;
  return MUTE_MODES.includes(value) ? value : "TIMEOUT";
}

/**
 * @param {object} settings
 * @returns {"ALL"|"TEXT"|"VOICE"}
 */
function muteScope(settings) {
  const value = moderationConfig(settings)?.default_mute_scope;
  return MUTE_SCOPES.includes(value) ? value : "ALL";
}

/**
 * @param {object} settings
 * @returns {string|null}
 */
function muteRoleId(settings) {
  return moderationConfig(settings)?.mute_role || null;
}

/**
 * @param {object} settings
 * @returns {string[]}
 */
function muteExcludedChannelIds(settings) {
  return moderationConfig(settings)?.mute_excluded_channels || [];
}

/**
 * @param {object} settings
 * @returns {boolean}
 */
function blockReactionsEnabled(settings) {
  return Boolean(moderationConfig(settings)?.block_reactions);
}

/**
 * @param {object} settings
 * @returns {boolean} whether a mute assigns the configured role at all
 */
function usesRoleMute(settings) {
  return muteMode(settings) !== "TIMEOUT";
}

/**
 * @param {object} settings
 * @returns {boolean} whether a mute applies Discord's own timeout at all
 */
function usesTimeoutMute(settings) {
  return muteMode(settings) !== "ROLE";
}

/**
 * @param {object} settings
 * @returns {boolean} scope denies sending in text channels
 */
function scopeCoversText(settings) {
  const scope = muteScope(settings);
  return scope === "ALL" || scope === "TEXT";
}

/**
 * @param {object} settings
 * @returns {boolean} scope denies connecting to voice channels
 */
function scopeCoversVoice(settings) {
  const scope = muteScope(settings);
  return scope === "ALL" || scope === "VOICE";
}

/**
 * Whether this member is currently muted by whichever mechanism the server
 * actually uses - the role, Discord's own timeout, or either under BOTH.
 *
 * @param {import('discord.js').GuildMember} member
 * @param {object} settings
 * @returns {boolean}
 */
function isMuted(member, settings) {
  if (!member) return false;

  if (usesRoleMute(settings)) {
    const roleId = muteRoleId(settings);
    if (roleId && member.roles?.cache?.has(roleId)) return true;
  }

  if (usesTimeoutMute(settings)) {
    const until = member.communicationDisabledUntilTimestamp;
    if (until && until > Date.now()) return true;
  }

  return false;
}

module.exports = {
  DEFAULT_WARNING_EXPIRY_DAYS,
  MUTE_MODES,
  MUTE_SCOPES,
  blockReactionsEnabled,
  cooldownExemptEnabled,
  isCooldownExemptModerator,
  isModerator,
  isMuted,
  moderationConfig,
  moderatorRoleIds,
  muteExcludedChannelIds,
  muteMode,
  muteRoleId,
  muteScope,
  respectsRoleHierarchy,
  scopeCoversText,
  scopeCoversVoice,
  usesRoleMute,
  usesTimeoutMute,
  warningExpiryDays,
};
