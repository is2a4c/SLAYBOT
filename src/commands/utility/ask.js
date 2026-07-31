const { ApplicationCommandOptionType, EmbedBuilder } = require("discord.js");
const { EMBED_COLORS } = require("@root/config");
const { getAiService } = require("@src/services/ai/AiService");

async function answerQuestion(guildId, question, settings, service = getAiService()) {
  const ai = settings.ai;
  if (!ai?.enabled || !ai.knowledge_enabled || !String(ai.knowledge || "").trim()) {
    return { error: "AI server knowledge is not configured." };
  }
  if (!service.isConfigured()) return { error: "The AI provider is not configured by the bot operator." };

  try {
    return await service.answerFromKnowledge({
      guildId,
      knowledge: ai.knowledge,
      question,
    });
  } catch {
    return { error: "The AI service is temporarily unavailable. Please try again later." };
  }
}

function answerEmbed(question, result) {
  return new EmbedBuilder()
    .setColor(result.answered ? EMBED_COLORS.BOT_EMBED : EMBED_COLORS.WARNING)
    .setAuthor({ name: "SLAYBOT AI • Server knowledge" })
    .setDescription(result.answer.slice(0, 1900))
    .addFields({ name: "Question", value: question.slice(0, 1024) });
}

/**
 * @type {import("@structures/Command")}
 */
module.exports = {
  name: "ask",
  description: "ask a question using this server's configured knowledge",
  category: "UTILITY",
  cooldown: 15,
  command: {
    enabled: true,
    usage: "<question>",
    minArgsCount: 1,
  },
  slashCommand: {
    enabled: true,
    ephemeral: false,
    options: [
      {
        name: "question",
        description: "question about this server",
        type: ApplicationCommandOptionType.String,
        required: true,
        maxLength: 2000,
      },
    ],
  },

  async messageRun(message, args, data) {
    const question = args.join(" ").trim().slice(0, 2000);
    const result = await answerQuestion(message.guildId, question, data.settings);
    if (result.error) return message.safeReply(result.error);
    return message.safeReply({ embeds: [answerEmbed(question, result)] });
  },

  async interactionRun(interaction, data) {
    const question = interaction.options.getString("question").trim().slice(0, 2000);
    const result = await answerQuestion(interaction.guildId, question, data.settings);
    if (result.error) return interaction.safeFollowUp(result.error);
    return interaction.safeFollowUp({ embeds: [answerEmbed(question, result)] });
  },

  answerQuestion,
  answerEmbed,
};
