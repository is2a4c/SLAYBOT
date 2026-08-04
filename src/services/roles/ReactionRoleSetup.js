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
 * @param {string} key translation key
 * @param {object} [vars]
 * @returns {{ok: false, key: string, vars: object}}
 */
const refuse = (key, vars = {}) => ({ ok: false, key, vars });

/**
 * Put a set of reaction roles on a message.
 *
 * The outcome is returned as a key and its values rather than as a finished
 * sentence: the panel and the command both show it, and both have to say it in
 * the language of the server they are configuring. It also means the caller can
 * tell success from refusal by asking, instead of by reading the wording.
 *
 * @param {import('discord.js').Guild} guild
 * @param {import('discord.js').GuildTextBasedChannel} channel
 * @param {string} messageId
 * @param {string} input pairs such as "😀 @Member, 🎮 @Gamer"
 * @returns {Promise<{ok: boolean, key: string, vars: object}>}
 */
async function applyReactionRoles(guild, channel, messageId, input) {
  if (!channel.permissionsFor(guild.members.me).has(CHANNEL_PERMISSIONS)) {
    return refuse("reactionRoles.needPermissions", {
      channel: channel.toString(),
      permissions: parsePermissions(CHANNEL_PERMISSIONS),
    });
  }

  let targetMessage;
  try {
    targetMessage = await channel.messages.fetch({ message: messageId });
  } catch {
    return refuse("reactionRoles.messageNotFound");
  }

  let requested;
  try {
    requested = parseReactionRoleMappings(input);
  } catch (ex) {
    return refuse(ex.key || "reactionRoles.badPairs", ex.vars);
  }

  const roles = [];
  const seenEmojis = new Set();
  for (const pair of requested) {
    const role = guild.roles.cache.get(pair.roleId);
    if (!role) return refuse("reactionRoles.roleNotFound", { role: `<@&${pair.roleId}>` });
    if (role.managed) return refuse("reactionRoles.roleManaged", { role: role.toString() });
    if (guild.roles.everyone.id === role.id) return refuse("reactionRoles.roleEveryone");
    if (guild.members.me.roles.highest.position <= role.position) {
      return refuse("reactionRoles.roleTooHigh", { role: role.toString() });
    }

    let emote;
    try {
      emote = normalizeReactionEmoji(pair.reaction, guild);
    } catch (ex) {
      return refuse(ex.key || "reactionRoles.badEmoji", ex.vars);
    }
    if (seenEmojis.has(emote)) return refuse("reactionRoles.duplicateEmoji", { emoji: pair.reaction });

    seenEmojis.add(emote);
    roles.push({ emote, role_id: role.id });
  }

  for (const role of roles) {
    try {
      await targetMessage.react(role.emote);
    } catch {
      return refuse("reactionRoles.reactionFailed", { emoji: showEmote(guild, role.emote) });
    }
  }

  const previousRoles = getReactionRoles(guild.id, channel.id, targetMessage.id);
  try {
    await replaceReactionRoles(guild.id, channel.id, targetMessage.id, roles);
  } catch {
    return refuse("reactionRoles.saveFailed");
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

  return { ok: true, key: "reactionRoles.saved", vars: { count: roles.length } };
}

module.exports = { CHANNEL_PERMISSIONS, applyReactionRoles, formatReactionRoles, showEmote };
