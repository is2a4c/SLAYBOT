const { closePoll, getPoll } = require("@schemas/Poll");
const {
  CLOSE_PREFIX,
  VOTE_PREFIX,
  applyVote,
  buildPollComponents,
  buildPollEmbed,
  buildResultSummary,
} = require("@helpers/Polls");

const TASK_TYPE = "POLL_CLOSE";

/**
 * @param {import('discord.js').Message} message
 * @param {object} poll
 */
async function renderPoll(message, poll) {
  return message.edit({
    embeds: [buildPollEmbed(poll, { showVoters: !poll.anonymous })],
    components: buildPollComponents(poll),
  });
}

/**
 * Close a poll and post the result under it.
 * @param {import('discord.js').Client} client
 * @param {{guildId: string, channelId: string, messageId: string}} target
 */
async function finishPoll(client, { guildId, channelId, messageId }) {
  const poll = await closePoll(guildId, messageId);
  if (!poll) return null;

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return poll;

  const message = await channel.messages.fetch(messageId).catch(() => null);
  if (message) await renderPoll(message, poll).catch(() => {});

  await channel
    .send({
      content: `🔒 **${poll.question}**\n${buildResultSummary(poll)}`,
      reply: message ? { messageReference: message.id } : undefined,
    })
    .catch(() => {});

  return poll;
}

module.exports = {
  CLOSE_PREFIX,
  TASK_TYPE,
  VOTE_PREFIX,
  finishPoll,
  renderPoll,

  /**
   * @param {import('discord.js').StringSelectMenuInteraction} interaction
   */
  async handleVote(interaction) {
    const [, messageId] = interaction.customId.split(":");
    const poll = await getPoll(interaction.guildId, messageId);
    if (!poll) return interaction.reply({ content: "This poll no longer exists.", ephemeral: true });

    const { picks, error } = applyVote({
      poll,
      userId: interaction.user.id,
      selected: interaction.values.map((value) => Number.parseInt(value, 10)),
    });

    if (error) return interaction.reply({ content: error, ephemeral: true });

    if (picks.length === 0) poll.votes.delete(interaction.user.id);
    else poll.votes.set(interaction.user.id, picks);
    await poll.save();

    await renderPoll(interaction.message, poll).catch(() => {});

    const chosen = picks.map((index) => poll.options[index].label);
    return interaction.reply({
      content: chosen.length ? `Your vote: ${chosen.join(", ")}` : "Your vote was cleared.",
      ephemeral: true,
    });
  },

  /**
   * @param {import('discord.js').ButtonInteraction} interaction
   */
  async handleClose(interaction) {
    const [, messageId] = interaction.customId.split(":");
    const poll = await getPoll(interaction.guildId, messageId);
    if (!poll) return interaction.reply({ content: "This poll no longer exists.", ephemeral: true });
    if (poll.closed) return interaction.reply({ content: "This poll is already closed.", ephemeral: true });

    const isAuthor = poll.author_id === interaction.user.id;
    const isStaff = interaction.member.permissions.has("ManageMessages");
    if (!isAuthor && !isStaff) {
      return interaction.reply({ content: "Only the poll author or staff can close this poll.", ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });
    await finishPoll(interaction.client, {
      guildId: interaction.guildId,
      channelId: poll.channel_id,
      messageId: poll.message_id,
    });

    return interaction.editReply("Poll closed.");
  },

  /**
   * Scheduler handler for polls that carry a deadline.
   * @param {object} payload
   * @param {{client: import('discord.js').Client, task: object}} context
   */
  async handleScheduledClose(payload, { client, task }) {
    await finishPoll(client, {
      guildId: task.guild_id,
      channelId: payload.channelId,
      messageId: payload.messageId,
    });
  },

  /**
   * @param {import('@src/services/scheduler/Scheduler').Scheduler} scheduler
   */
  register(scheduler) {
    scheduler.register(TASK_TYPE, module.exports.handleScheduledClose);
    return scheduler;
  },
};
