const { reactionRoleHandler, starboardHandler } = require("@src/handlers");
const { getSettings } = require("@schemas/Guild");

/**
 * @param {import('@src/structures').BotClient} client
 * @param {import('discord.js').MessageReaction|import('discord.js').PartialMessageReaction} reaction
 * @param {import('discord.js').User} user
 */
module.exports = async (client, reaction, user) => {
  if (reaction.partial) {
    try {
      await reaction.fetch();
    } catch (ex) {
      return; // Possibly deleted
    }
  }

  await reactionRoleHandler.handleReactionRemove(reaction, user);

  // Starboard - a removed star can push the message back below the threshold
  if (reaction.message.guild) {
    const settings = await getSettings(reaction.message.guild);
    await starboardHandler
      .syncStarboard(reaction, settings)
      .catch((ex) => client.logger.error("starboard: reaction remove", ex));
  }
};
