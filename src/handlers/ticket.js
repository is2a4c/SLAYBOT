const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  StringSelectMenuBuilder,
  ComponentType,
} = require("discord.js");
const { TICKET } = require("@root/config.js");

// schemas
const { getSettings } = require("@schemas/Guild");

// helpers
const { postToBin } = require("@helpers/HttpUtils");
const { error } = require("@helpers/Logger");
const { canCloseTicket } = require("@helpers/TicketPermissions");
const { sendCategoryTicketNotification } = require("@helpers/TicketNotifications");

const OPEN_PERMS = ["ManageChannels"];
const CLOSE_PERMS = ["ManageChannels", "ReadMessageHistory"];
const BUTTON_STYLES = {
  PRIMARY: ButtonStyle.Primary,
  SECONDARY: ButtonStyle.Secondary,
  SUCCESS: ButtonStyle.Success,
  DANGER: ButtonStyle.Danger,
};

function requiredClosePermissions(ticketConfig) {
  return ticketConfig?.transcripts === false ? ["ManageChannels"] : CLOSE_PERMS;
}

/**
 * @param {import('discord.js').Channel} channel
 */
function isTicketChannel(channel) {
  return channel.type === ChannelType.GuildText && channel.topic && channel.topic.startsWith("tіcket|");
}

/**
 * @param {import('discord.js').Guild} guild
 */
function getTicketChannels(guild) {
  return guild.channels.cache.filter((ch) => isTicketChannel(ch));
}

/**
 * @param {import('discord.js').Guild} guild
 * @param {string} userId
 */
function getExistingTicketChannel(guild, userId) {
  const tktChannels = getTicketChannels(guild);
  return tktChannels.filter((ch) => ch.topic.split("|")[1] === userId).first();
}

/**
 * @param {import('discord.js').BaseGuildTextChannel} channel
 */
async function parseTicketDetails(channel) {
  if (!channel.topic) return;
  const split = channel.topic?.split("|");
  const userId = split[1];
  const catName = split[2] || "Default";
  const user = await channel.client.users.fetch(userId, { cache: false }).catch(() => {});
  return { user, catName };
}

/**
 * @param {import('discord.js').BaseGuildTextChannel} channel
 * @param {import('discord.js').User} closedBy
 * @param {string} [reason]
 */
async function closeTicket(channel, closedBy, reason) {
  try {
    const config = await getSettings(channel.guild);
    const closePermissions = requiredClosePermissions(config.ticket);
    if (!channel.deletable || !channel.permissionsFor(channel.guild.members.me).has(closePermissions)) {
      return "MISSING_PERMISSIONS";
    }

    let logsUrl = null;
    if (config.ticket.transcripts !== false) {
      const messages = await channel.messages.fetch();
      const reversed = Array.from(messages.values()).reverse();
      let content = "";
      reversed.forEach((m) => {
        content += `[${new Date(m.createdAt).toLocaleString("en-US")}] - ${m.author.username}\n`;
        if (m.cleanContent !== "") content += `${m.cleanContent}\n`;
        if (m.attachments.size > 0) content += `${m.attachments.map((att) => att.proxyURL).join(", ")}\n`;
        content += "\n";
      });
      logsUrl = await postToBin(content, `Ticket Logs for ${channel.name}`);
    }
    const ticketDetails = await parseTicketDetails(channel);

    const components = [];
    if (logsUrl) {
      components.push(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setLabel("Transcript").setURL(logsUrl.short).setStyle(ButtonStyle.Link)
        )
      );
    }

    if (channel.deletable) await channel.delete();

    const embed = new EmbedBuilder().setAuthor({ name: "Ticket Closed" }).setColor(TICKET.CLOSE_EMBED);
    const fields = [];

    if (reason) fields.push({ name: "Reason", value: reason, inline: false });
    fields.push(
      {
        name: "Opened By",
        value: ticketDetails.user ? ticketDetails.user.username : "Unknown",
        inline: true,
      },
      {
        name: "Closed By",
        value: closedBy ? closedBy.username : "Unknown",
        inline: true,
      }
    );

    embed.setFields(fields);

    // send embed to log channel
    if (config.ticket.log_channel) {
      const logChannel = channel.guild.channels.cache.get(config.ticket.log_channel);
      if (logChannel) logChannel.safeSend({ embeds: [embed], components });
    }

    // send embed to user
    if (ticketDetails.user && config.ticket.dm_on_close !== false) {
      const dmEmbed = embed
        .setDescription(`**Server:** ${channel.guild.name}\n**Category:** ${ticketDetails.catName}`)
        .setThumbnail(channel.guild.iconURL());
      ticketDetails.user.send({ embeds: [dmEmbed], components }).catch((ex) => {});
    }

    return "SUCCESS";
  } catch (ex) {
    error("closeTicket", ex);
    return "ERROR";
  }
}

/**
 * @param {import('discord.js').Guild} guild
 * @param {import('discord.js').User} author
 */
async function closeAllTickets(guild, author) {
  const channels = getTicketChannels(guild);
  let success = 0;
  let failed = 0;

  for (const ch of channels) {
    const status = await closeTicket(ch[1], author, "Force close all open tickets");
    if (status === "SUCCESS") success += 1;
    else failed += 1;
  }

  return [success, failed];
}

/**
 * @param {import("discord.js").ButtonInteraction} interaction
 */
async function handleTicketOpen(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const { guild, user } = interaction;

  if (!guild.members.me.permissions.has(OPEN_PERMS))
    return interaction.safeFollowUp(
      "Cannot create ticket channel, missing `Manage Channel` permission. Contact server manager for help!"
    );

  const alreadyExists = getExistingTicketChannel(guild, user.id);
  if (alreadyExists) return interaction.safeFollowUp(`You already have an open ticket`);

  const settings = await getSettings(guild);

  // limit check
  const existing = getTicketChannels(guild).size;
  if (existing >= settings.ticket.limit)
    return interaction.safeFollowUp("There are too many open tickets. Try again later");

  // check categories
  let catName = null;
  let catPerms = [];
  let selectedCategory = null;
  const categories = settings.ticket.categories;
  if (categories.length > 0) {
    const options = [];
    settings.ticket.categories
      .slice(0, 25)
      .forEach((cat) => options.push({ label: cat.name.slice(0, 100), value: cat.name.slice(0, 100) }));
    const menuRow = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId("ticket-menu")
        .setPlaceholder("Choose the ticket category")
        .addOptions(options)
    );

    const prompt = await interaction.editReply({ content: "Please choose a ticket category", components: [menuRow] });
    const res = await prompt
      .awaitMessageComponent({
        componentType: ComponentType.StringSelect,
        filter: (i) => i.customId === "ticket-menu" && i.user.id === user.id && i.message.id === prompt.id,
        time: Math.min(300, Math.max(15, Number(settings.ticket.category_timeout_seconds) || 60)) * 1000,
      })
      .catch((err) => {
        if (err.message.includes("time")) return;
      });

    if (!res) return interaction.editReply({ content: "Timed out. Try again", components: [] });
    await res.deferUpdate();
    await interaction.editReply({ content: "Processing", components: [] });
    catName = res.values[0];
    selectedCategory = categories.find((cat) => cat.name === catName);
    catPerms = selectedCategory?.staff_roles || [];
  }

  try {
    const ticketNumber = (existing + 1).toString();
    const permissionOverwrites = [
      {
        id: guild.roles.everyone,
        deny: ["ViewChannel"],
      },
      {
        id: user.id,
        allow: ["ViewChannel", "SendMessages", "ReadMessageHistory"],
      },
      {
        id: guild.members.me.roles.highest.id,
        allow: ["ViewChannel", "SendMessages", "ReadMessageHistory"],
      },
    ];

    const staffRoleIds = [...new Set([...(settings.ticket.staff_roles || []), ...(catPerms || [])])];
    if (staffRoleIds.length > 0) {
      staffRoleIds.forEach((roleId) => {
        const role = guild.roles.cache.get(roleId);
        if (!role) return;
        permissionOverwrites.push({
          id: role,
          allow: ["ViewChannel", "SendMessages", "ReadMessageHistory"],
        });
      });
    }

    const channelName = String(settings.ticket.channel_name_template || "tіcket-{number}")
      .replace(/{number}/g, ticketNumber)
      .replace(/{user}/g, user.username)
      .replace(/{id}/g, user.id)
      .replace(/[^\p{L}\p{N}_-]+/gu, "-")
      .slice(0, 100);
    const tktChannel = await guild.channels.create({
      name: channelName || `tіcket-${ticketNumber}`,
      type: ChannelType.GuildText,
      parent:
        settings.ticket.category_id &&
        guild.channels.cache.get(settings.ticket.category_id)?.type === ChannelType.GuildCategory
          ? settings.ticket.category_id
          : undefined,
      topic: `tіcket|${user.id}|${catName || "Default"}`,
      permissionOverwrites,
    });

    const embed = new EmbedBuilder().setAuthor({ name: `Ticket #${ticketNumber}` }).setDescription(
      String(settings.ticket.opening_message || "Hello {member}\nSupport will be with you shortly\n{category}")
        .replace(/{member}/g, user.toString())
        .replace(/{username}/g, user.username)
        .replace(/{category}/g, catName ? `**Category:** ${catName}` : "")
        .slice(0, 4096)
    );
    if (settings.ticket.opening_color) embed.setColor(settings.ticket.opening_color);
    if (settings.ticket.opening_footer) embed.setFooter({ text: settings.ticket.opening_footer.slice(0, 200) });

    let buttonsRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel(String(settings.ticket.close_button_label || "Close Ticket").slice(0, 80))
        .setCustomId("TICKET_CLOSE")
        .setEmoji("🔒")
        .setStyle(BUTTON_STYLES[settings.ticket.close_button_style] || ButtonStyle.Primary)
    );

    const sent = await tktChannel.send({
      content: settings.ticket.ping_member === false ? undefined : user.toString(),
      embeds: [embed],
      components: [buttonsRow],
    });

    await sendCategoryTicketNotification({
      guild,
      user,
      settings,
      category: selectedCategory,
      ticketMessage: sent,
    }).catch((ex) => error("sendCategoryTicketNotification", ex));

    const dmEmbed = new EmbedBuilder()
      .setColor(TICKET.CREATE_EMBED)
      .setAuthor({ name: "Ticket Created" })
      .setThumbnail(guild.iconURL())
      .setDescription(
        `**Server:** ${guild.name}
        ${catName ? `**Category:** ${catName}` : ""}
        `
      );

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel("View Channel").setURL(sent.url).setStyle(ButtonStyle.Link)
    );

    if (settings.ticket.dm_on_create !== false) {
      user.send({ embeds: [dmEmbed], components: [row] }).catch(() => {});
    }

    await interaction.editReply(`Ticket created! 🔥`);
  } catch (ex) {
    error("handleTicketOpen", ex);
    return interaction.editReply("Failed to create ticket channel, an error occurred!");
  }
}

/**
 * @param {import("discord.js").ButtonInteraction} interaction
 */
async function handleTicketClose(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const settings = await getSettings(interaction.guild);
  if (!canCloseTicket(interaction.member, interaction.user.id, settings, interaction.channel)) {
    return interaction.safeFollowUp("Only the ticket owner or configured support staff can close this ticket.");
  }

  const status = await closeTicket(interaction.channel, interaction.user);
  if (status === "MISSING_PERMISSIONS") {
    return interaction.safeFollowUp("Cannot close the ticket, missing permissions. Contact server manager for help!");
  } else if (status == "ERROR") {
    return interaction.safeFollowUp("Failed to close the ticket, an error occurred!");
  }
}

module.exports = {
  getTicketChannels,
  getExistingTicketChannel,
  isTicketChannel,
  closeTicket,
  closeAllTickets,
  requiredClosePermissions,
  handleTicketOpen,
  handleTicketClose,
};
