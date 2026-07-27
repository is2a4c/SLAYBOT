const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ModalBuilder,
  TextInputBuilder,
  ButtonStyle,
  TextInputStyle,
} = require("discord.js");
const { EMBED_COLORS } = require("@root/config.js");

// schemas
const { findForm, hasResponded, addResponse } = require("@schemas/Forms");

// helpers
const { error } = require("@helpers/Logger");

// a discord modal cannot hold more than 5 inputs
const MAX_QUESTIONS = 5;

// discord limits for a text input label and for an embed field value
const MAX_QUESTION_LENGTH = 45;
const MAX_ANSWER_LENGTH = 1000;

const BUTTON_PREFIX = "FORM_FILL";
const MODAL_PREFIX = "FORM_MODAL";

/**
 * Parses the questions typed by the admin in the setup modal.
 * One question per line, with optional `| short` and `| optional` flags
 * @param {string} input
 * @returns {{questions: object[], error: string}}
 */
function parseQuestions(input) {
  const lines = (input || "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) return { questions: [], error: "You must provide at least one question" };
  if (lines.length > MAX_QUESTIONS) {
    return { questions: [], error: `A form cannot have more than ${MAX_QUESTIONS} questions` };
  }

  const questions = [];
  for (const line of lines) {
    const [label, ...flags] = line.split("|").map((part) => part.trim());
    if (!label) return { questions: [], error: "Question text cannot be empty" };
    if (label.length > MAX_QUESTION_LENGTH) {
      return { questions: [], error: `Question \`${label}\` is longer than ${MAX_QUESTION_LENGTH} characters` };
    }

    const normalized = flags.map((flag) => flag.toLowerCase());
    questions.push({
      label,
      style: normalized.includes("short") ? "SHORT" : "PARAGRAPH",
      required: !normalized.includes("optional"),
    });
  }

  return { questions, error: null };
}

/**
 * @param {object} form
 */
function buildFormEmbed(form) {
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLORS.BOT_EMBED)
    .setAuthor({ name: form.title })
    .setDescription(form.description || "Please use the button below to fill this form")
    .setFooter({ text: `Form ID: ${form.form_id}` });

  embed.addFields({
    name: "Questions",
    value: form.questions.map((q, i) => `**${i + 1}.** ${q.label}${q.required ? "" : " _(optional)_"}`).join("\n"),
  });

  return embed;
}

/**
 * @param {object} form
 */
function buildFormButtonRow(form) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${BUTTON_PREFIX}:${form.form_id}`)
      .setLabel(form.button_label || "Fill the form")
      .setEmoji("📋")
      .setStyle(ButtonStyle.Success)
      .setDisabled(!form.enabled)
  );
}

/**
 * @param {object} form
 */
function buildFormModal(form) {
  return new ModalBuilder({
    customId: `${MODAL_PREFIX}:${form.form_id}`,
    title: form.title.slice(0, 45),
    components: form.questions.map((question, i) =>
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId(`question-${i}`)
          .setLabel(question.label.slice(0, MAX_QUESTION_LENGTH))
          .setStyle(question.style === "SHORT" ? TextInputStyle.Short : TextInputStyle.Paragraph)
          .setMaxLength(MAX_ANSWER_LENGTH)
          .setRequired(question.required)
      )
    ),
  });
}

/**
 * @param {import('discord.js').Guild} guild
 * @param {object} form
 * @param {import('discord.js').User} user
 * @param {{question: string, answer: string}[]} answers
 */
async function sendResponseToChannel(guild, form, user, answers) {
  const channelId = form.response_channel || form.channel_id;
  const channel = guild.channels.cache.get(channelId);
  if (!channel || !channel.canSendEmbeds()) return false;

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLORS.SUCCESS)
    .setAuthor({ name: `New response: ${form.title}` })
    .setThumbnail(user.displayAvatarURL())
    .setDescription(`**Submitted by:** ${user.toString()} (\`${user.username}\`)`)
    .setFooter({ text: `Form ID: ${form.form_id} • User ID: ${user.id}` })
    .setTimestamp();

  embed.addFields(
    answers.map((ans) => ({
      name: ans.question.slice(0, 256),
      value: (ans.answer || "_No answer_").slice(0, 1024),
    }))
  );

  const sent = await channel.safeSend({ embeds: [embed] });
  return !!sent;
}

/**
 * @param {import("discord.js").ButtonInteraction} interaction
 */
async function handleFormButton(interaction) {
  const formId = interaction.customId.split(":")[1];
  const form = await findForm(interaction.guildId, formId);

  if (!form) {
    return interaction.reply({ content: "This form no longer exists", ephemeral: true });
  }

  if (!form.enabled) {
    return interaction.reply({ content: "This form is closed and no longer accepts responses", ephemeral: true });
  }

  if (!form.allow_multiple && (await hasResponded(interaction.guildId, formId, interaction.user.id))) {
    return interaction.reply({ content: "You have already submitted a response to this form", ephemeral: true });
  }

  await interaction.showModal(buildFormModal(form));
}

/**
 * @param {import("discord.js").ModalSubmitInteraction} interaction
 */
async function handleFormModal(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const formId = interaction.customId.split(":")[1];

  try {
    const form = await findForm(interaction.guildId, formId);
    if (!form) return interaction.followUp("This form no longer exists");
    if (!form.enabled) return interaction.followUp("This form is closed and no longer accepts responses");

    if (!form.allow_multiple && (await hasResponded(interaction.guildId, formId, interaction.user.id))) {
      return interaction.followUp("You have already submitted a response to this form");
    }

    const answers = form.questions.map((question, i) => ({
      question: question.label,
      answer: interaction.fields.getTextInputValue(`question-${i}`)?.trim() || "",
    }));

    await addResponse(interaction.guildId, formId, interaction.user.id, answers);
    const delivered = await sendResponseToChannel(interaction.guild, form, interaction.user, answers);

    return interaction.followUp(
      delivered
        ? "Your response has been recorded. Thank you!"
        : "Your response has been recorded, but I could not post it in the responses channel. Please inform a moderator"
    );
  } catch (ex) {
    error("handleFormModal", ex);
    return interaction.followUp("Failed to save your response, an error occurred!");
  }
}

module.exports = {
  MAX_QUESTIONS,
  MAX_QUESTION_LENGTH,
  BUTTON_PREFIX,
  MODAL_PREFIX,
  parseQuestions,
  buildFormEmbed,
  buildFormButtonRow,
  handleFormButton,
  handleFormModal,
};
