const {
  ApplicationCommandOptionType,
  ChannelType,
  ModalBuilder,
  ActionRowBuilder,
  TextInputBuilder,
  TextInputStyle,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  EmbedBuilder,
} = require("discord.js");
const { isValidColor, isHex } = require("@helpers/Utils");
const { EMBED_COLORS } = require("@root/config");
const { MAX_FOOTER, MAX_NAME, resolveBranding, sanitizeBranding } = require("@helpers/Branding");

/**
 * @type {import("@structures/Command")}
 */
module.exports = {
  name: "embed",
  description: "send custom embeds and set this server's bot branding",
  category: "ADMIN",
  userPermissions: ["ManageMessages"],
  command: {
    enabled: true,
    usage: "<#channel> | branding",
    minArgsCount: 1,
    aliases: ["say"],
    subcommands: [
      { trigger: "<#channel>", description: "build and send an embed interactively" },
      { trigger: "branding", description: "show this server's branding" },
    ],
  },
  slashCommand: {
    enabled: true,
    ephemeral: true,
    options: [
      {
        name: "send",
        description: "build and send an embed interactively",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "channel",
            description: "channel to send embed",
            type: ApplicationCommandOptionType.Channel,
            channelTypes: [ChannelType.GuildText],
            required: true,
          },
        ],
      },
      {
        name: "branding",
        description: "make the bot's embeds look like your server (Manage Server)",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "name",
            description: `name shown in embed footers (max ${MAX_NAME} chars)`,
            type: ApplicationCommandOptionType.String,
            required: false,
          },
          {
            name: "color",
            description: "accent colour as a hex value, e.g. #A855F7",
            type: ApplicationCommandOptionType.String,
            required: false,
          },
          {
            name: "footer",
            description: `footer text for the bot's embeds (max ${MAX_FOOTER} chars)`,
            type: ApplicationCommandOptionType.String,
            required: false,
          },
          {
            name: "icon",
            description: "https URL of the footer icon",
            type: ApplicationCommandOptionType.String,
            required: false,
          },
          {
            name: "reset",
            description: "clear the branding and go back to the bot defaults",
            type: ApplicationCommandOptionType.Boolean,
            required: false,
          },
        ],
      },
    ],
  },

  async messageRun(message, args, data) {
    if (args[0]?.toLowerCase() === "branding") {
      return message.safeReply({ embeds: [brandingEmbed(message.client, data.settings)] });
    }

    const channel = message.mentions.channels.first() || message.guild.channels.cache.get(args[0]);
    if (!channel) return message.reply("Please provide a valid channel");
    if (channel.type !== ChannelType.GuildText) return message.reply("Please provide a valid channel");
    if (!channel.canSendEmbeds()) {
      return message.reply("I don't have permission to send embeds in that channel");
    }
    message.reply(`Embed setup started in ${channel}`);
    await embedSetup(channel, message.member);
  },

  async interactionRun(interaction, data) {
    const sub = interaction.options.getSubcommand();

    if (sub === "branding") {
      if (!interaction.member.permissions.has("ManageGuild")) {
        return interaction.followUp("You need the `Manage Server` permission to change branding");
      }
      return interaction.followUp(await runBranding(interaction, data.settings));
    }

    const channel = interaction.options.getChannel("channel");
    if (!channel.canSendEmbeds()) {
      return interaction.followUp("I don't have permission to send embeds in that channel");
    }
    interaction.followUp(`Embed setup started in ${channel}`);
    await embedSetup(channel, interaction.member);
  },
};

/**
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @param {object} settings
 */
async function runBranding(interaction, settings) {
  if (interaction.options.getBoolean("reset")) {
    settings.branding = { name: null, color: null, footer: null, iconURL: null };
    await settings.save();
    return "Branding cleared. The bot uses its own defaults again.";
  }

  const { branding, errors } = sanitizeBranding({
    name: interaction.options.getString("name"),
    color: interaction.options.getString("color"),
    footer: interaction.options.getString("footer"),
    iconURL: interaction.options.getString("icon"),
  });

  if (errors.length) return errors.join("\n");
  if (Object.keys(branding).length === 0) {
    return { embeds: [brandingEmbed(interaction.client, settings)] };
  }

  Object.assign(settings.branding, branding);
  await settings.save();

  const applied = Object.entries(branding).map(([key, value]) => `${key}: ${value ?? "cleared"}`);
  return `Branding updated (${applied.join(", ")}). It applies to the panels and announcements the bot posts.`;
}

/**
 * @param {import('discord.js').Client} client
 * @param {object} settings
 */
function brandingEmbed(client, settings) {
  const branding = resolveBranding(settings, client);
  const own = settings?.branding || {};

  const embed = new EmbedBuilder()
    .setColor(branding.color || EMBED_COLORS.BOT_EMBED)
    .setAuthor({ name: `Branding · ${branding.name}` })
    .setDescription(
      [
        `**Name:** ${own.name || `${branding.name} (bot default)`}`,
        `**Accent colour:** ${own.color || `${branding.color} (bot default)`}`,
        `**Footer:** ${own.footer || "not set"}`,
        `**Footer icon:** ${own.iconURL || "bot avatar"}`,
        "",
        "Set it with `/embed branding` and clear it with `/embed branding reset:true`.",
      ].join("\n")
    );

  if (branding.iconURL) embed.setThumbnail(branding.iconURL);
  return embed;
}

/**
 * @param {import('discord.js').GuildTextBasedChannel} channel
 * @param {import('discord.js').GuildMember} member
 */
async function embedSetup(channel, member) {
  const sentMsg = await channel.send({
    content: "Click the button below to get started",
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("EMBED_ADD").setLabel("Create Embed").setStyle(ButtonStyle.Primary)
      ),
    ],
  });

  const btnInteraction = await channel
    .awaitMessageComponent({
      componentType: ComponentType.Button,
      filter: (i) => i.customId === "EMBED_ADD" && i.member.id === member.id && i.message.id === sentMsg.id,
      time: 20000,
    })
    .catch((ex) => {});

  if (!btnInteraction) return sentMsg.edit({ content: "No response received", components: [] });

  await btnInteraction.showModal(
    new ModalBuilder({
      customId: "EMBED_MODAL",
      title: "Embed Generator",
      components: [
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("title")
            .setLabel("Embed Title")
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("author")
            .setLabel("Embed Author")
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("description")
            .setLabel("Embed Description")
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("color")
            .setLabel("Embed Color")
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("footer")
            .setLabel("Embed Footer")
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
        ),
      ],
    })
  );

  // receive modal input
  const modal = await btnInteraction
    .awaitModalSubmit({
      time: 1 * 60 * 1000,
      filter: (m) => m.customId === "EMBED_MODAL" && m.member.id === member.id && m.message?.id === sentMsg.id,
    })
    .catch((ex) => {});

  if (!modal) return sentMsg.edit({ content: "No response received, cancelling setup", components: [] });

  modal.reply({ content: "Embed sent", ephemeral: true }).catch((ex) => {});

  const title = modal.fields.getTextInputValue("title");
  const author = modal.fields.getTextInputValue("author");
  const description = modal.fields.getTextInputValue("description");
  const footer = modal.fields.getTextInputValue("footer");
  const color = modal.fields.getTextInputValue("color");

  if (!title && !author && !description && !footer)
    return sentMsg.edit({ content: "You can't send an empty embed!", components: [] });

  const embed = new EmbedBuilder();
  if (title) embed.setTitle(title);
  if (author) embed.setAuthor({ name: author });
  if (description) embed.setDescription(description);
  if (footer) embed.setFooter({ text: footer });
  if ((color && isValidColor(color)) || (color && isHex(color))) embed.setColor(color);

  // add/remove field button
  const buttonRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("EMBED_FIELD_ADD").setLabel("Add Field").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("EMBED_FIELD_REM").setLabel("Remove Field").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId("EMBED_FIELD_DONE").setLabel("Done").setStyle(ButtonStyle.Primary)
  );

  await sentMsg.edit({
    content: "Please add fields using the buttons below. Click done when you are done.",
    embeds: [embed],
    components: [buttonRow],
  });

  const collector = channel.createMessageComponentCollector({
    componentType: ComponentType.Button,
    filter: (i) =>
      i.member.id === member.id &&
      i.message.id === sentMsg.id &&
      ["EMBED_FIELD_ADD", "EMBED_FIELD_REM", "EMBED_FIELD_DONE"].includes(i.customId),
    idle: 5 * 60 * 1000,
  });

  collector.on("collect", async (interaction) => {
    if (interaction.customId === "EMBED_FIELD_ADD") {
      await interaction.showModal(
        new ModalBuilder({
          customId: "EMBED_ADD_FIELD_MODAL",
          title: "Add Field",
          components: [
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId("name")
                .setLabel("Field Name")
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId("value")
                .setLabel("Field Value")
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId("inline")
                .setLabel("Inline? (true/false)")
                .setStyle(TextInputStyle.Short)
                .setValue("true")
                .setRequired(true)
            ),
          ],
        })
      );

      // receive modal input
      const modal = await interaction
        .awaitModalSubmit({
          time: 5 * 60 * 1000,
          filter: (m) =>
            m.customId === "EMBED_ADD_FIELD_MODAL" && m.member.id === member.id && m.message?.id === sentMsg.id,
        })
        .catch((ex) => {});

      if (!modal) return sentMsg.edit({ components: [] });

      modal.reply({ content: "Field added", ephemeral: true }).catch((ex) => {});

      const name = modal.fields.getTextInputValue("name");
      const value = modal.fields.getTextInputValue("value");
      let inline = modal.fields.getTextInputValue("inline").toLowerCase();

      if (inline === "true") inline = true;
      else if (inline === "false") inline = false;
      else inline = true; // default to true

      const fields = embed.data.fields || [];
      fields.push({ name, value, inline });
      embed.setFields(fields);
    }

    // remove field
    else if (interaction.customId === "EMBED_FIELD_REM") {
      const fields = embed.data.fields;
      if (fields) {
        fields.pop();
        embed.setFields(fields);
        interaction.reply({ content: "Field removed", ephemeral: true });
      } else {
        interaction.reply({ content: "There are no fields to remove", ephemeral: true });
      }
    }

    // done
    else if (interaction.customId === "EMBED_FIELD_DONE") {
      await interaction.deferUpdate();
      return collector.stop();
    }

    await sentMsg.edit({ embeds: [embed] });
  });

  collector.on("end", async (_collected, _reason) => {
    await sentMsg.edit({ content: "", components: [] });
  });
}
