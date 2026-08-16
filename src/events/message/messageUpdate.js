const { routeEvent } = require("@src/services/eventRouter/EventRouter");

/**
 * @param {import('@src/structures').BotClient} client
 * @param {import('discord.js').Message|import('discord.js').PartialMessage} oldMessage
 * @param {import('discord.js').Message|import('discord.js').PartialMessage} newMessage
 */
module.exports = async (client, oldMessage, newMessage) => {
  if (!newMessage.guild) return;
  if (newMessage.partial || oldMessage.partial) return;
  if (newMessage.author?.bot) return;

  // Discord also fires this for embed-only changes (a link finishing its
  // unfurl) - only the text actually changing is an edit worth auditing.
  if (oldMessage.content === newMessage.content) return;

  await routeEvent(newMessage.guild, "MESSAGE_EDIT", {
    actor: newMessage.author,
    detail: `${(oldMessage.content || "(empty)").slice(0, 80)} → ${(newMessage.content || "(empty)").slice(0, 80)}`,
    channelId: newMessage.channelId,
    logger: client.logger,
  });
};
