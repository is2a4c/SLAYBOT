const { BaseInteraction } = require("discord.js");

/**
 * Answer an interaction without caring how it was opened.
 *
 * A deferred interaction is edited rather than followed up: `followUp` would
 * leave the "thinking" placeholder hanging next to the real answer, which reads
 * as the message loading forever. Anything after the first answer becomes a
 * genuine follow-up, so a command that speaks twice still gets two messages.
 *
 * @param {string|import('discord.js').MessagePayload|import('discord.js').InteractionReplyOptions} content
 */
BaseInteraction.prototype.safeFollowUp = async function (content) {
  if (!content) return;

  try {
    if (this.replied) return await this.followUp(content);
    if (this.deferred) return await this.editReply(content);
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
