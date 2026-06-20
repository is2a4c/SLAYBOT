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
    if (ex.code === "InteractionNotReplied" && !this.deferred) {
      try {
        return await this.reply(content);
      } catch (replyError) {
        this.client.logger.error("safeFollowUp reply fallback", replyError);
      }
    }

    if (ex.code === "InteractionAlreadyReplied") {
      try {
        return await this.followUp(content);
      } catch (followUpError) {
        this.client.logger.error("safeFollowUp follow-up fallback", followUpError);
      }
    }

    this.client.logger.error("safeFollowUp", ex);
  }
};
