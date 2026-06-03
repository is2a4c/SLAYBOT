const { BaseInteraction } = require("discord.js");

/**
 * @param {string|import('discord.js').MessagePayload|import('discord.js').InteractionReplyOptions} content
 */
BaseInteraction.prototype.safeFollowUp = async function (content) {
  if (!content) return;

  try {
    if (this.deferred) return await this.editReply(content);
    if (this.replied) return await this.followUp(content);
    return await this.reply(content);
  } catch (ex) {
    this.client.logger.error("safeFollowUp", ex);
  }
};
