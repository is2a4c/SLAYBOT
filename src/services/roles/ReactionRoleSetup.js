const { getReactionRoles, replaceReactionRoles } = require("@schemas/ReactionRoles");
const { normalizeReactionEmoji, parseReactionRoleMappings } = require("@helpers/ReactionRoleMappings");
const { parsePermissions } = require("@helpers/Utils");

/**
 * Putting a set of reaction roles on a message.
 *
 * Shared by the `setrr` command and the reaction-roles panel, because the awkward
 * parts are the same either way: the bot must be able to react in that channel,
 * every role must be one it can actually hand out, and the reactions it no longer
 * uses have to be taken off again.
 */

const CHANNEL_PERMISSIONS = ["EmbedLinks", "ReadMessageHistory", "AddReactions", "UseExternalEmojis", "ManageMessages"];

/**
 * The stored emote as something a person can read and retype.
 *
 * @param {import('discord.js').Guild} guild
 * @param {string} emote unicode emoji, or the id of a server emoji
 */
function showEmote(guild, emote) {
  if (!/^\d{17,20}$/.test(String(emote))) return emote;
  return guild.emojis.cache.get(emote)?.toString() || `<:emoji:${emote}>`;
}

/**
 * A message's pairs written back out the way they are typed in.
 *
 * @param {import('discord.js').Guild} guild
 * @param {{emote: string, role_id: string}[]} roles
 * @returns {string}
 */
function formatReactionRoles(guild, roles = []) {
  return roles.map((role) => `${showEmote(guild, role.emote)} <@&${role.role_id}>`).join(", ");
}

/**
 * @param {import('discord.js').Guild} guild
 * @param {import('discord.js').GuildTextBasedChannel} channel
 * @param {string} messageId
 * @param {string} input pairs such as "😀 @Member, 🎮 @Gamer"
 * @returns {Promise<string>} what to tell whoever asked for it
 */
async function applyReactionRoles(guild, channel, messageId, input) {
  if (!channel.permissionsFor(guild.members.me).has(CHANNEL_PERMISSIONS)) {
    return `You need the following permissions in ${channel.toString()}\n${parsePermissions(CHANNEL_PERMISSIONS)}`;
  }

  let targetMessage;
  try {
    targetMessage = await channel.messages.fetch({ message: messageId });
  } catch {
    return "Could not fetch message. Did you provide a valid messageId?";
  }

  let requested;
  try {
    requested = parseReactionRoleMappings(input);
  } catch (ex) {
    return ex.message;
  }

  const roles = [];
  const seenEmojis = new Set();
  for (const pair of requested) {
    const role = guild.roles.cache.get(pair.roleId);
    if (!role) return `Role <@&${pair.roleId}> was not found on this server.`;
    if (role.managed) return `I cannot assign the managed role ${role.toString()}.`;
    if (guild.roles.everyone.id === role.id) return "You cannot assign the everyone role.";
    if (guild.members.me.roles.highest.position <= role.position) {
      return `I cannot assign ${role.toString()}. Move my highest role above it and try again.`;
    }

    let emote;
    try {
      emote = normalizeReactionEmoji(pair.reaction, guild);
    } catch (ex) {
      return ex.message;
    }
    if (seenEmojis.has(emote)) return `Emoji ${pair.reaction} is listed more than once.`;

    seenEmojis.add(emote);
    roles.push({ emote, role_id: role.id });
  }

  for (const role of roles) {
    try {
      await targetMessage.react(role.emote);
    } catch {
      return `Failed to add reaction ${role.emote}. No configuration was saved.`;
    }
  }

  const previousRoles = getReactionRoles(guild.id, channel.id, targetMessage.id);
  try {
    await replaceReactionRoles(guild.id, channel.id, targetMessage.id, roles);
  } catch {
    return "Failed to save reaction roles. Try again later.";
  }

  // Reactions that are no longer part of the set stop being offered.
  const obsoleteEmojis = previousRoles.map((role) => role.emote).filter((emote) => !seenEmojis.has(emote));
  await Promise.all(
    obsoleteEmojis.map((emote) =>
      targetMessage.reactions
        .resolve(emote)
        ?.users.remove(guild.members.me.id)
        .catch(() => {})
    )
  );

  return `Done! Saved ${roles.length} reaction role${roles.length === 1 ? "" : "s"} for this message.`;
}

module.exports = { CHANNEL_PERMISSIONS, applyReactionRoles, formatReactionRoles, showEmote };
