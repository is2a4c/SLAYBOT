const {
  PREFIX_JOIN,
  PREFIX_LEAVE,
  PREFIX_SKIP,
  PREFIX_STOP,
  PREFIX_VOTE,
  handleJoin,
  handleLeave,
  handleSkip,
  handleStop,
  handleVote,
} = require("@src/services/forestFuss/game");

const BUTTON_PREFIXES = [PREFIX_JOIN, PREFIX_LEAVE, PREFIX_SKIP, PREFIX_STOP];

module.exports = {
  matchesButton: (customId) => BUTTON_PREFIXES.some((prefix) => String(customId).startsWith(`${prefix}:`)),
  matchesSelect: (customId) => String(customId).startsWith(`${PREFIX_VOTE}:`),

  /**
   * @param {import('discord.js').ButtonInteraction} interaction
   * @param {object} settings
   */
  async handleButton(interaction, settings) {
    const [prefix] = interaction.customId.split(":");
    if (prefix === PREFIX_JOIN) return handleJoin(interaction, settings);
    if (prefix === PREFIX_LEAVE) return handleLeave(interaction, settings);
    if (prefix === PREFIX_SKIP) return handleSkip(interaction, settings);
    if (prefix === PREFIX_STOP) return handleStop(interaction, settings);
  },

  /**
   * @param {import('discord.js').StringSelectMenuInteraction} interaction
   * @param {object} settings
   */
  handleSelect(interaction, settings) {
    return handleVote(interaction, settings);
  },
};
