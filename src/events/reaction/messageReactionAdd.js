const { translationHandler, reactionRoleHandler, starboardHandler } = require("@src/handlers");
const { getSettings } = require("@schemas/Guild");
const { isValidEmoji } = require("country-emoji-languages");
const { blockReactionsEnabled, isMuted } = require("@src/services/moderation/policy");

/**
 * @param {import('@src/structures').BotClient} client
 * @param {import('discord.js').MessageReaction|import('discord.js').PartialMessageReaction} reaction
 * @param {import('discord.js').User|import('discord.js').PartialUser} user
 */
module.exports = async (client, reaction, user) => {
  if (reaction.partial) {
    try {
      await reaction.fetch();
    } catch (ex) {
      return; // Failed to fetch message (maybe deleted)
    }
  }
  if (user.partial) await user.fetch();
  const { message, emoji } = reaction;
  if (user.bot) return;

  // Reaction Roles
  reactionRoleHandler.handleReactionAdd(reaction, user);

  const settings = message.guild ? await getSettings(message.guild) : null;

  // A muted member gets no reactions at all, when the server asked for that -
  // native timeout already blocks this on Discord's own side, so this mainly
  // matters for the role-based mute, which Discord knows nothing about.
  if (settings && blockReactionsEnabled(settings)) {
    const member =
      message.guild.members.cache.get(user.id) || (await message.guild.members.fetch(user.id).catch(() => null));
    if (member && isMuted(member, settings)) {
      await reaction.users.remove(user.id).catch(() => {});
      return;
    }
  }

  // Starboard
  if (message.guild) {
    starboardHandler
      .syncStarboard(reaction, settings)
      .catch((ex) => client.logger.error("starboard: reaction add", ex));
  }

  // Handle Reaction Emojis
  if (!emoji.id) {
    // Translation By Flags
    if (message.content && settings?.flag_translation.enabled) {
      if (isValidEmoji(emoji.name)) {
        translationHandler.handleFlagReaction(emoji.name, message, user, settings);
      }
    }
  }
};
