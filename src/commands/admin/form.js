const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ModalBuilder,
  TextInputBuilder,
  ApplicationCommandOptionType,
  ChannelType,
  ButtonStyle,
  TextInputStyle,
  ComponentType,
} = require("discord.js");
const crypto = require("crypto");
const { EMBED_COLORS } = require("@root/config.js");
const { MAX_QUESTIONS, parseQuestions, buildFormEmbed, buildFormButtonRow } = require("@handlers/form");
const { createForm, findForm, getForms, deleteForm } = require("@schemas/Forms");
const { postToBin } = require("@helpers/HttpUtils");

/**
 * @type {import("@structures/Command")}
 */
module.exports = {
  name: "form",
  description: "create and manage forms/questionnaires",
  category: "ADMIN",
  userPermissions: ["ManageGuild"],
  command: {
    enabled: true,
    minArgsCount: 1,
    subcommands: [
      {
        trigger: "create <#channel> [#responses-channel]",
        description: "start an interactive form setup",
      },
      {
        trigger: "list",
        description: "list all forms of this server",
      },
      {
        trigger: "status <formId> <on|off>",
        description: "open or close a form",
      },
      {
        trigger: "responses <formId>",
        description: "get all responses submitted to a form",
      },
      {
        trigger: "delete <formId>",
        description: "delete a form and its responses",
      },
    ],
  },
  slashCommand: {
    enabled: true,
    ephemeral: true,
    options: [
      {
        name: "create",
        description: "start an interactive form setup",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "channel",
            description: "the channel where the form message must be sent",
            type: ApplicationCommandOptionType.Channel,
            channelTypes: [ChannelType.GuildText],
            required: true,
          },
          {
            name: "responses_channel",
            description: "the channel where responses must be sent (defaults to the form channel)",
            type: ApplicationCommandOptionType.Channel,
            channelTypes: [ChannelType.GuildText],
            required: false,
          },
          {
            name: "multiple",
            description: "allow a member to submit more than one response (default: no)",
            type: ApplicationCommandOptionType.Boolean,
            required: false,
          },
        ],
      },
      {
        name: "list",
        description: "list all forms of this server",
        type: ApplicationCommandOptionType.Subcommand,
      },
      {
        name: "status",
        description: "open or close a form",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "form_id",
            description: "the id of the form",
            type: ApplicationCommandOptionType.String,
            required: true,
          },
          {
            name: "status",
            description: "open or close the form",
            type: ApplicationCommandOptionType.String,
            required: true,
            choices: [
              { name: "ON", value: "ON" },
              { name: "OFF", value: "OFF" },
            ],
          },
        ],
      },
      {
        name: "responses",
        description: "get all responses submitted to a form",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "form_id",
            description: "the id of the form",
            type: ApplicationCommandOptionType.String,
            required: true,
          },
        ],
      },
      {
        name: "delete",
        description: "delete a form and its responses",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "form_id",
            description: "the id of the form",
            type: ApplicationCommandOptionType.String,
            required: true,
          },
        ],
      },
    ],
  },

  async messageRun(message, args) {
    const sub = args[0].toLowerCase();
    let response;

    // create
    if (sub === "create") {
      if (args.length < 2) return message.safeReply("Please provide a channel where the form must be sent");

      const targetChannel = message.guild.findMatchingChannels(args[1])[0];
      if (!targetChannel) return message.safeReply("I could not find channel with that name");

      let responseChannel = targetChannel;
      if (args[2]) {
        responseChannel = message.guild.findMatchingChannels(args[2])[0];
        if (!responseChannel) return message.safeReply("I could not find the responses channel with that name");
      }

      return formModalSetup(message, targetChannel, responseChannel, false);
    }

    // list
    else if (sub === "list") {
      return message.safeReply({ embeds: [await listForms(message.guild)] });
    }

    // status
    else if (sub === "status") {
      if (args.length < 3) return message.safeReply("Usage: `form status <formId> <on|off>`");
      const status = args[2].toUpperCase();
      if (!["ON", "OFF"].includes(status)) return message.safeReply("Invalid status. Value must be `on/off`");
      response = await setStatus(message.guild, args[1], status);
    }

    // responses
    else if (sub === "responses") {
      if (args.length < 2) return message.safeReply("Please provide a form id");
      response = await getResponses(message.guild, args[1]);
    }

    // delete
    else if (sub === "delete") {
      if (args.length < 2) return message.safeReply("Please provide a form id");
      response = await removeForm(message.guild, args[1]);
    }

    // invalid input
    else {
      return message.safeReply("Incorrect command usage");
    }

    if (response) await message.safeReply(response);
  },

  async interactionRun(interaction) {
    const sub = interaction.options.getSubcommand();
    let response;

    // create
    if (sub === "create") {
      const channel = interaction.options.getChannel("channel");
      const responseChannel = interaction.options.getChannel("responses_channel") || channel;
      const allowMultiple = interaction.options.getBoolean("multiple") || false;

      await interaction.deleteReply();
      return formModalSetup(interaction, channel, responseChannel, allowMultiple);
    }

    // list
    else if (sub === "list") {
      return interaction.safeFollowUp({ embeds: [await listForms(interaction.guild)] });
    }

    // status
    else if (sub === "status") {
      const formId = interaction.options.getString("form_id");
      const status = interaction.options.getString("status");
      response = await setStatus(interaction.guild, formId, status);
    }

    // responses
    else if (sub === "responses") {
      const formId = interaction.options.getString("form_id");
      response = await getResponses(interaction.guild, formId);
    }

    // delete
    else if (sub === "delete") {
      const formId = interaction.options.getString("form_id");
      response = await removeForm(interaction.guild, formId);
    }

    if (response) await interaction.safeFollowUp(response);
  },
};

/**
 * Interactive setup: a button is sent in the current channel, which opens the setup modal
 * @param {import('discord.js').Message|import('discord.js').ChatInputCommandInteraction} param0
 * @param {import('discord.js').GuildTextBasedChannel} targetChannel
 * @param {import('discord.js').GuildTextBasedChannel} responseChannel
 * @param {boolean} allowMultiple
 */
async function formModalSetup({ guild, channel, member }, targetChannel, responseChannel, allowMultiple) {
  if (!targetChannel.canSendEmbeds()) {
    return channel.safeSend(`Oops! I do not have permission to send embeds to ${targetChannel}`);
  }
  if (!responseChannel.canSendEmbeds()) {
    return channel.safeSend(`Oops! I do not have permission to send embeds to ${responseChannel}`);
  }

  const buttonRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("form_btnSetup").setLabel("Setup Form").setStyle(ButtonStyle.Primary)
  );

  const sentMsg = await channel.safeSend({
    content: "Please click the button below to setup the form",
    components: [buttonRow],
  });

  if (!sentMsg) return;

  const btnInteraction = await channel
    .awaitMessageComponent({
      componentType: ComponentType.Button,
      filter: (i) => i.customId === "form_btnSetup" && i.member.id === member.id && i.message.id === sentMsg.id,
      time: 20000,
    })
    .catch((ex) => {});

  if (!btnInteraction) return sentMsg.edit({ content: "No response received, cancelling setup", components: [] });

  // display modal
  await btnInteraction.showModal(
    new ModalBuilder({
      customId: "form-modalSetup",
      title: "Form Setup",
      components: [
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("title")
            .setLabel("Form Title")
            .setStyle(TextInputStyle.Short)
            .setMaxLength(100)
            .setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("description")
            .setLabel("Form Description")
            .setStyle(TextInputStyle.Paragraph)
            .setMaxLength(1000)
            .setRequired(false)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("questions")
            .setLabel(`Questions (1 per line, max ${MAX_QUESTIONS})`)
            .setPlaceholder("Your age? | short\nWhy do you want to join? | optional")
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("button_label")
            .setLabel("Button Label")
            .setStyle(TextInputStyle.Short)
            .setMaxLength(80)
            .setRequired(false)
        ),
      ],
    })
  );

  // receive modal input
  const modal = await btnInteraction
    .awaitModalSubmit({
      time: 5 * 60 * 1000,
      filter: (m) => m.customId === "form-modalSetup" && m.member.id === member.id && m.message?.id === sentMsg.id,
    })
    .catch((ex) => {});

  if (!modal) return sentMsg.edit({ content: "No response received, cancelling setup", components: [] });

  await modal.reply("Setting up the form ...");
  const title = modal.fields.getTextInputValue("title").trim();
  const description = modal.fields.getTextInputValue("description").trim();
  const buttonLabel = modal.fields.getTextInputValue("button_label").trim();

  const { questions, error: parseError } = parseQuestions(modal.fields.getTextInputValue("questions"));
  if (parseError) {
    await modal.deleteReply();
    return sentMsg.edit({ content: `Setup cancelled: ${parseError}`, components: [] });
  }

  const formDoc = await createForm({
    form_id: await generateFormId(guild.id),
    guild_id: guild.id,
    channel_id: targetChannel.id,
    response_channel: responseChannel.id,
    title,
    description,
    button_label: buttonLabel || "Fill the form",
    questions,
    created_by: member.id,
    enabled: true,
    allow_multiple: allowMultiple,
  });

  // the message holds the button members click, so drop the form if it cannot be sent
  try {
    const sent = await targetChannel.send({
      embeds: [buildFormEmbed(formDoc)],
      components: [buildFormButtonRow(formDoc)],
    });
    formDoc.message_id = sent.id;
    await formDoc.save();
  } catch (ex) {
    await deleteForm(guild.id, formDoc.form_id);
    await modal.deleteReply();
    return sentMsg.edit({ content: `Setup cancelled: failed to send the form to ${targetChannel}`, components: [] });
  }

  await modal.deleteReply();
  await sentMsg.edit({
    content: `Done! Form created with id \`${formDoc.form_id}\`. Responses will be sent to ${responseChannel}`,
    components: [],
  });
}

/**
 * Generates a short id that is not yet used in this guild
 * @param {string} guildId
 */
async function generateFormId(guildId) {
  for (let i = 0; i < 5; i += 1) {
    const formId = crypto.randomBytes(3).toString("hex");
    if (!(await findForm(guildId, formId))) return formId;
  }
  return crypto.randomBytes(6).toString("hex");
}

/**
 * @param {import('discord.js').Guild} guild
 */
async function listForms(guild) {
  const forms = await getForms(guild.id);

  const embed = new EmbedBuilder().setColor(EMBED_COLORS.BOT_EMBED).setAuthor({ name: `Forms in ${guild.name}` });

  if (!forms || forms.length === 0) {
    return embed.setDescription("There are no forms in this server. Use `form create` to add one");
  }

  return embed.setDescription(
    forms
      .map(
        (form) =>
          `\`${form.form_id}\` • **${form.title}** ${form.enabled ? "🟢" : "🔴"}\n` +
          `❯ Channel: <#${form.channel_id}> | Responses: ${form.responses}`
      )
      .join("\n\n")
      .slice(0, 4000)
  );
}

/**
 * @param {import('discord.js').Guild} guild
 * @param {string} formId
 * @param {string} status
 */
async function setStatus(guild, formId, status) {
  const form = await findForm(guild.id, formId);
  if (!form) return `No form found with id \`${formId}\``;

  form.enabled = status.toUpperCase() === "ON";
  await form.save();
  await updateFormMessage(guild, form);

  return `Form \`${form.form_id}\` is now ${form.enabled ? "open" : "closed"}`;
}

/**
 * @param {import('discord.js').Guild} guild
 * @param {string} formId
 */
async function getResponses(guild, formId) {
  const form = await findForm(guild.id, formId);
  if (!form) return `No form found with id \`${formId}\``;
  if (form.responses.length === 0) return `Form \`${form.form_id}\` has no responses yet`;

  let content = `Responses for "${form.title}" [${form.form_id}]\n\n`;
  for (const response of form.responses) {
    const user = await guild.client.users.fetch(response.user_id, { cache: false }).catch(() => {});
    content += `[${new Date(response.submitted_at).toLocaleString("en-US")}] - ${user?.username || response.user_id}\n`;
    response.answers.forEach((ans) => {
      content += `${ans.question}\n> ${ans.answer || "No answer"}\n`;
    });
    content += "\n";
  }

  const binUrl = await postToBin(content, `Form responses for ${form.title}`);
  if (!binUrl) return `Form \`${form.form_id}\` has \`${form.responses.length}\` responses, but the export failed`;

  return `Form \`${form.form_id}\` has \`${form.responses.length}\` responses: ${binUrl.short}`;
}

/**
 * @param {import('discord.js').Guild} guild
 * @param {string} formId
 */
async function removeForm(guild, formId) {
  const form = await deleteForm(guild.id, formId);
  if (!form) return `No form found with id \`${formId}\``;

  // remove the form message if it still exists
  const channel = guild.channels.cache.get(form.channel_id);
  if (channel && form.message_id) {
    const message = await channel.messages.fetch(form.message_id).catch(() => {});
    if (message?.deletable) await message.delete().catch(() => {});
  }

  return `Form \`${form.form_id}\` and its \`${form.responses.length}\` responses have been deleted`;
}

/**
 * Refreshes the form message so that the button reflects the current status
 * @param {import('discord.js').Guild} guild
 * @param {object} form
 */
async function updateFormMessage(guild, form) {
  const channel = guild.channels.cache.get(form.channel_id);
  if (!channel || !form.message_id) return;

  const message = await channel.messages.fetch(form.message_id).catch(() => {});
  if (!message?.editable) return;

  await message.edit({ embeds: [buildFormEmbed(form)], components: [buildFormButtonRow(form)] }).catch(() => {});
}
