const { BaseInteraction } = require("discord.js");

/**
 * Answer an interaction without caring how it was opened.
 *
 * A deferred interaction is edited rather than followed up: `followUp` would
 * leave the "thinking" placeholder hanging next to the real answer, which reads
 * as the message loading forever. Anything after the first answer becomes a
 * genuine follow-up, so a command that speaks twice still gets two messages.
 *
 * A `.reply()` on a fresh interaction is not itself a deletable message - only
 * `followUp`/`editReply` genuinely return one - so `seconds` quietly does
 * nothing on that path rather than throwing; every real call site here defers
 * first, which is what makes deletion actually work in practice.
 *
 * @param {string|import('discord.js').MessagePayload|import('discord.js').InteractionReplyOptions} content
 * @param {number} [seconds] delete the answer after this many seconds
 */
BaseInteraction.prototype.safeFollowUp = async function (content, seconds) {
  if (!content) return;

  const withCleanup = async (send) => {
    const sent = await send();
    if (seconds && sent?.deletable) {
      setTimeout(() => sent.delete().catch(() => {}), seconds * 1000);
    }
    return sent;
  };

  try {
    if (this.replied) return await withCleanup(() => this.followUp(content));
    if (this.deferred) return await withCleanup(() => this.editReply(content));
    return await withCleanup(() => this.reply(content));
  } catch (ex) {
    if (ex.code === "InteractionNotReplied" && !this.deferred) {
      try {
        return await withCleanup(() => this.reply(content));
      } catch (replyError) {
        this.client.logger.error("safeFollowUp reply fallback", replyError);
      }
    }

    if (ex.code === "InteractionAlreadyReplied") {
      try {
        return await withCleanup(() => this.followUp(content));
      } catch (followUpError) {
        this.client.logger.error("safeFollowUp follow-up fallback", followUpError);
      }
    }

    this.client.logger.error("safeFollowUp", ex);
  }
};
