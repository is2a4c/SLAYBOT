/**
 * A server's own rules for how its ranking works: who and where earns
 * nothing, how much text and voice activity are worth relative to each
 * other, how many members the leaderboard bothers to show, and whether a
 * member's progress survives them leaving and rejoining.
 *
 * Read here and nowhere else, so the message handler, the voice handler, the
 * leaderboard query and the rank card all agree on the same rules.
 */

// A voice minute is worth this many XP before the server's own multiplier -
// roughly what an active chatter earns from a handful of messages at the
// default per-message range, so neither channel dominates by default.
const VOICE_XP_PER_MINUTE = 8;
const DEFAULT_MAX_MEMBERS = 10000;

/**
 * @param {object} settings guild settings document
 * @returns {object|null}
 */
function rankingConfig(settings) {
  return settings?.control_center?.ranking || null;
}

/**
 * @param {object} settings
 * @param {import('discord.js').GuildMember} [member]
 * @returns {boolean} true when this member earns nothing at all, in any channel
 */
function memberIgnored(settings, member) {
  const ignoredRoles = rankingConfig(settings)?.ignored_roles;
  if (!ignoredRoles?.length) return false;
  return ignoredRoles.some((roleId) => Boolean(member?.roles?.cache?.has(roleId)));
}

/**
 * @param {object} settings
 * @param {import('discord.js').GuildMember} [member]
 * @param {string} [channelId]
 * @returns {boolean} true when a text message here earns no XP
 */
function textXpIgnored(settings, member, channelId) {
  if (memberIgnored(settings, member)) return true;
  const ignoredChannels = rankingConfig(settings)?.ignored_text_channels;
  return Boolean(ignoredChannels?.length && channelId && ignoredChannels.includes(channelId));
}

/**
 * @param {object} settings
 * @returns {number} multiplies text XP; 1 when the server never set one
 */
function textMultiplier(settings) {
  const value = Number(rankingConfig(settings)?.text_multiplier);
  return Number.isFinite(value) && value >= 0 ? value : 1;
}

/**
 * @param {object} settings
 * @returns {boolean} whether voice activity earns XP at all on this server
 */
function voiceXpEnabled(settings) {
  return Boolean(rankingConfig(settings)?.voice_enabled);
}

/**
 * @param {object} settings
 * @param {import('discord.js').GuildMember} [member]
 * @param {string} [channelId]
 * @returns {boolean} true when time in this channel earns no XP
 */
function voiceXpIgnored(settings, member, channelId) {
  if (memberIgnored(settings, member)) return true;
  const ignoredChannels = rankingConfig(settings)?.ignored_voice_channels;
  return Boolean(ignoredChannels?.length && channelId && ignoredChannels.includes(channelId));
}

/**
 * @param {object} settings
 * @returns {number} multiplies voice XP; 1 when the server never set one
 */
function voiceMultiplier(settings) {
  const value = Number(rankingConfig(settings)?.voice_multiplier);
  return Number.isFinite(value) && value >= 0 ? value : 1;
}

/**
 * @param {number} seconds time spent connected
 * @param {number} multiplier
 * @returns {number} whole XP earned, never negative
 */
function voiceXpForSeconds(seconds, multiplier) {
  const minutes = Math.max(0, Number(seconds) || 0) / 60;
  return Math.max(0, Math.round(minutes * VOICE_XP_PER_MINUTE * multiplier));
}

/**
 * A server can shrink the leaderboard it shows, never grow past what was
 * asked for - this only ever tightens a limit, never loosens it.
 *
 * @param {object} settings
 * @param {number} requested
 * @returns {number}
 */
function leaderboardLimit(settings, requested) {
  const configured = Number(rankingConfig(settings)?.max_members);
  const cap = Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_MAX_MEMBERS;
  return Math.max(1, Math.min(requested, cap));
}

/**
 * @param {object} settings
 * @returns {boolean} whether a member's progress is cleared when they leave
 */
function resetOnLeave(settings) {
  return Boolean(rankingConfig(settings)?.reset_on_leave);
}

/**
 * @param {object} settings
 * @returns {{accent: string|null, background: string|null}}
 */
function cardStyle(settings) {
  const config = rankingConfig(settings);
  return { accent: config?.card_accent || null, background: config?.card_background || null };
}

/**
 * @param {object} settings
 * @returns {boolean} whether the leaderboard has an unauthenticated page
 */
function publicPageEnabled(settings) {
  return Boolean(rankingConfig(settings)?.public_page);
}

module.exports = {
  DEFAULT_MAX_MEMBERS,
  VOICE_XP_PER_MINUTE,
  cardStyle,
  leaderboardLimit,
  memberIgnored,
  publicPageEnabled,
  rankingConfig,
  resetOnLeave,
  textMultiplier,
  textXpIgnored,
  voiceMultiplier,
  voiceXpEnabled,
  voiceXpForSeconds,
  voiceXpIgnored,
};
