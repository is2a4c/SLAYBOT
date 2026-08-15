const { ChannelType } = require("discord.js");
const { muteExcludedChannelIds, scopeCoversText, scopeCoversVoice } = require("./policy");

// A conventional "muted" role's overwrites: no talking in text channels
// (including threads and reactions), no talking or connecting in voice ones.
const TEXT_DENY_FLAGS = ["SendMessages", "SendMessagesInThreads", "AddReactions"];
const VOICE_DENY_FLAGS = ["Connect", "Speak"];

/**
 * @param {import('discord.js').GuildBasedChannel} channel
 */
function isTextChannel(channel) {
  return Boolean(channel.isTextBased?.()) && !channel.isThread?.() && !isVoiceChannel(channel);
}

/**
 * @param {import('discord.js').GuildBasedChannel} channel
 */
function isVoiceChannel(channel) {
  return channel.type === ChannelType.GuildVoice || channel.type === ChannelType.GuildStageVoice;
}

/**
 * Deny the given permission flags for a role on a channel, skipping the API
 * call when they are already denied.
 *
 * @param {import('discord.js').GuildBasedChannel} channel
 * @param {import('discord.js').Role} role
 * @param {string[]} flags
 */
async function denyFlags(channel, role, flags) {
  const current = channel.permissionOverwrites.cache.get(role.id);
  if (flags.every((flag) => current?.deny?.has(flag))) return;

  const patch = {};
  for (const flag of flags) patch[flag] = false;
  await channel.permissionOverwrites.edit(role, patch, "SLAYBOT mute role").catch(() => {});
}

/**
 * Make sure the mute role actually silences whatever the server's scope
 * says it should, on one channel. Safe to call for any channel type - it
 * only acts on the kinds the current scope covers.
 *
 * A scope narrowed after the role was already fully set up (e.g. from ALL
 * down to TEXT) is not retroactively cleaned up on the channels that no
 * longer need the deny - the overwrite becomes redundant but harmless.
 *
 * @param {import('discord.js').GuildBasedChannel} channel
 * @param {import('discord.js').Role} role
 * @param {object} settings
 */
async function ensureChannelOverwrite(channel, role, settings) {
  if (!channel.permissionOverwrites) return;
  if (muteExcludedChannelIds(settings).includes(channel.id)) return;

  if (scopeCoversText(settings) && isTextChannel(channel)) {
    await denyFlags(channel, role, TEXT_DENY_FLAGS);
  } else if (scopeCoversVoice(settings) && isVoiceChannel(channel)) {
    await denyFlags(channel, role, VOICE_DENY_FLAGS);
  }
}

/**
 * Ensure every channel in the guild the mute role should silence does.
 * Called before assigning the role, so a mute is effective the moment it
 * lands rather than depending on separate setup having happened first.
 *
 * @param {import('discord.js').Guild} guild
 * @param {import('discord.js').Role} role
 * @param {object} settings
 */
async function ensureGuildOverwrites(guild, role, settings) {
  if (!role) return;
  await Promise.all(
    [...guild.channels.cache.values()].map((channel) => ensureChannelOverwrite(channel, role, settings))
  );
}

module.exports = {
  TEXT_DENY_FLAGS,
  VOICE_DENY_FLAGS,
  ensureChannelOverwrite,
  ensureGuildOverwrites,
  isTextChannel,
  isVoiceChannel,
};
