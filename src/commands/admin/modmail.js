const { ApplicationCommandOptionType, ChannelType, EmbedBuilder } = require("discord.js");
const { EMBED_COLORS } = require("@root/config");
const { closeThread, getOpenThread, getThreadById, listOpenThreads, setBlocked } = require("@schemas/ModmailThread");
const { modmailHandler } = require("@src/handlers");

const MAX_STAFF_ROLES = 10;

/**
 * @type {import("@structures/Command")}
 */
module.exports = {
  name: "modmail",
  description: "let members talk to staff through the bot's direct messages",
  category: "ADMIN",
  botPermissions: ["EmbedLinks", "ManageThreads", "CreatePrivateThreads", "SendMessagesInThreads"],
  command: {
    enabled: true,
    usage: "<setup|status|off|close|block|unblock|list> ...",
    minArgsCount: 1,
    subcommands: [
      { trigger: "setup <#channel>", description: "enable modmail and choose the staff channel" },
      { trigger: "status", description: "show the modmail configuration" },
      { trigger: "off", description: "disable modmail" },
      { trigger: "close [reason]", description: "close the modmail thread you are in" },
      { trigger: "block <@member>", description: "stop a member from opening threads" },
      { trigger: "unblock <@member>", description: "let a blocked member open threads again" },
      { trigger: "list", description: "list the open modmail threads" },
    ],
  },
  slashCommand: {
    enabled: true,
    options: [
      {
        name: "setup",
        description: "enable modmail and choose the staff channel (Manage Server)",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "channel",
            description: "channel where the private threads are created",
            type: ApplicationCommandOptionType.Channel,
            channelTypes: [ChannelType.GuildText],
            required: true,
          },
          {
            name: "staff_role",
            description: "role pinged when a thread opens",
            type: ApplicationCommandOptionType.Role,
            required: false,
          },
          {
            name: "anonymous",
            description: "hide the staff member's name from replies",
            type: ApplicationCommandOptionType.Boolean,
            required: false,
          },
          {
            name: "mirror_replies",
            description: "forward every staff message in the thread (a leading dot stays internal)",
            type: ApplicationCommandOptionType.Boolean,
            required: false,
          },
        ],
      },
      {
        name: "status",
        description: "show the modmail configuration",
        type: ApplicationCommandOptionType.Subcommand,
      },
      {
        name: "off",
        description: "disable modmail (Manage Server)",
        type: ApplicationCommandOptionType.Subcommand,
      },
      {
        name: "contact",
        description: "open a modmail thread with the staff of this server",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "message",
            description: "what you want to tell the staff",
            type: ApplicationCommandOptionType.String,
            required: true,
          },
        ],
      },
      {
        name: "reply",
        description: "reply to the member of this modmail thread",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "message",
            description: "message sent to the member",
            type: ApplicationCommandOptionType.String,
            required: true,
          },
        ],
      },
      {
        name: "close",
        description: "close this modmail thread",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "reason",
            description: "why the thread was closed",
            type: ApplicationCommandOptionType.String,
            required: false,
          },
        ],
      },
      {
        name: "block",
        description: "stop a member from opening modmail threads",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "user",
            description: "member to block",
            type: ApplicationCommandOptionType.User,
            required: true,
          },
        ],
      },
      {
        name: "unblock",
        description: "let a blocked member open threads again",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "user",
            description: "member to unblock",
            type: ApplicationCommandOptionType.User,
            required: true,
          },
        ],
      },
      {
        name: "list",
        description: "list the open modmail threads",
        type: ApplicationCommandOptionType.Subcommand,
      },
    ],
  },

  async messageRun(message, args, data) {
    const sub = args[0].toLowerCase();
    const settings = data.settings;
    const isStaff = isStaffMember(message.member, settings);

    if (["setup", "off"].includes(sub) && !message.member.permissions.has("ManageGuild")) {
      return message.safeReply("You need the `Manage Server` permission for this subcommand");
    }
    if (["close", "block", "unblock", "list"].includes(sub) && !isStaff) {
      return message.safeReply("Only modmail staff can use this subcommand");
    }

    if (sub === "setup") {
      const channel = message.guild.findMatchingChannels(args[1])[0];
      if (!channel) return message.safeReply("Provide a valid text channel");
      return message.safeReply(await setup(message.guild, settings, { channel }));
    }

    if (sub === "status") return message.safeReply({ embeds: [statusEmbed(message.guild, settings)] });

    if (sub === "off") return message.safeReply(await disable(settings));

    if (sub === "close") {
      return message.safeReply(await close(message, args.slice(1).join(" "), message.author.id));
    }

    if (sub === "block" || sub === "unblock") {
      const target = await message.guild.resolveMember(args[1], true);
      if (!target) return message.safeReply("Provide a valid member");
      return message.safeReply(await block(message.guildId, target.user, sub === "block"));
    }

    if (sub === "list") return message.safeReply(await listThreads(message.guild));

    return message.safeReply("Invalid subcommand");
  },

  async interactionRun(interaction, data) {
    const sub = interaction.options.getSubcommand();
    const settings = data.settings;
    const isStaff = isStaffMember(interaction.member, settings);

    if (["setup", "off"].includes(sub) && !interaction.member.permissions.has("ManageGuild")) {
      return interaction.safeFollowUp("You need the `Manage Server` permission for this subcommand");
    }
    if (["reply", "close", "block", "unblock", "list"].includes(sub) && !isStaff) {
      return interaction.safeFollowUp("Only modmail staff can use this subcommand");
    }

    if (sub === "setup") {
      return interaction.safeFollowUp(
        await setup(interaction.guild, settings, {
          channel: interaction.options.getChannel("channel"),
          staffRole: interaction.options.getRole("staff_role"),
          anonymous: interaction.options.getBoolean("anonymous"),
          mirrorReplies: interaction.options.getBoolean("mirror_replies"),
        })
      );
    }

    if (sub === "status") return interaction.safeFollowUp({ embeds: [statusEmbed(interaction.guild, settings)] });

    if (sub === "off") return interaction.safeFollowUp(await disable(settings));

    if (sub === "contact") {
      return interaction.safeFollowUp(await contact(interaction, settings, interaction.options.getString("message")));
    }

    if (sub === "reply") {
      return interaction.safeFollowUp(await reply(interaction, settings, interaction.options.getString("message")));
    }

    if (sub === "close") {
      return interaction.safeFollowUp(
        await close(interaction, interaction.options.getString("reason"), interaction.user.id)
      );
    }

    if (sub === "block" || sub === "unblock") {
      return interaction.safeFollowUp(
        await block(interaction.guildId, interaction.options.getUser("user"), sub === "block")
      );
    }

    if (sub === "list") return interaction.safeFollowUp(await listThreads(interaction.guild));

    return interaction.safeFollowUp("Invalid subcommand");
  },
};

/**
 * @param {import('discord.js').GuildMember} member
 * @param {object} settings
 */
function isStaffMember(member, settings) {
  if (member.permissions.has("ManageGuild")) return true;
  const roles = settings.modmail?.staff_roles || [];
  return roles.some((roleId) => member.roles.cache.has(roleId));
}

async function setup(guild, settings, { channel, staffRole, anonymous, mirrorReplies }) {
  const permissions = channel.permissionsFor(guild.members.me);
  if (!permissions?.has(["ViewChannel", "SendMessages", "CreatePrivateThreads", "SendMessagesInThreads"])) {
    return `I need to view ${channel}, send messages there and create private threads.`;
  }

  settings.modmail.enabled = true;
  settings.modmail.channel_id = channel.id;
  if (anonymous !== null && anonymous !== undefined) settings.modmail.anonymous = anonymous;
  if (mirrorReplies !== null && mirrorReplies !== undefined) settings.modmail.mirror_replies = mirrorReplies;

  if (staffRole) {
    const roles = new Set(settings.modmail.staff_roles || []);
    if (roles.size >= MAX_STAFF_ROLES) return `At most ${MAX_STAFF_ROLES} staff roles can be configured.`;
    roles.add(staffRole.id);
    settings.modmail.staff_roles = [...roles];
  }

  await settings.save();

  return (
    `Modmail enabled. Threads are created in ${channel}. ` +
    `Members can DM the bot${settings.modmail.mirror_replies ? "; staff messages in the thread are forwarded back" : "; reply with `/modmail reply`"}.`
  );
}

async function disable(settings) {
  settings.modmail.enabled = false;
  await settings.save();
  return "Modmail disabled. Open threads stay where they are.";
}

async function contact(interaction, settings, content) {
  if (!settings.modmail?.enabled) return "Modmail is not enabled on this server.";

  const { thread, record, error } = await modmailHandler.ensureThread({
    guild: interaction.guild,
    user: interaction.user,
    settings,
  });

  if (!thread) return error;

  await thread.send({
    embeds: [
      modmailHandler.buildIncomingEmbed(interaction.user, {
        content,
        attachments: new Map(),
      }),
    ],
  });

  if (record) {
    record.last_user_message_at = new Date();
    record.messages += 1;
    await record.save().catch(() => {});
  }

  return "Your message was delivered to the staff. Replies arrive in your direct messages.";
}

async function reply(interaction, settings, content) {
  if (!interaction.channel.isThread() || interaction.channel.parentId !== settings.modmail?.channel_id) {
    return "Use this inside a modmail thread.";
  }

  const record = await getThreadById(interaction.guildId, interaction.channelId);
  if (!record?.open) return "This modmail thread is closed.";

  const user = await interaction.client.users.fetch(record.user_id).catch(() => null);
  if (!user) return "I can no longer reach that member.";

  const embed = modmailHandler.buildReplyEmbed(
    interaction.guild,
    interaction.member.displayName,
    content,
    settings.modmail.anonymous
  );

  const sent = await user.send({ embeds: [embed] }).catch(() => null);
  if (!sent) return "I could not deliver that: the member has DMs closed.";

  await interaction.channel.send({ embeds: [embed] }).catch(() => {});

  record.last_staff_message_at = new Date();
  record.messages += 1;
  await record.save().catch(() => {});

  return "Delivered.";
}

async function close(source, reason, closedBy) {
  const channel = source.channel;
  if (!channel?.isThread()) return "Use this inside a modmail thread.";

  const record = await getThreadById(source.guild.id, channel.id);
  if (!record?.open) return "This thread is not an open modmail thread.";

  await closeThread({ guildId: source.guild.id, threadId: channel.id, closedBy, reason });

  const user = await source.client.users.fetch(record.user_id).catch(() => null);
  if (user) {
    await user
      .send({
        embeds: [
          new EmbedBuilder()
            .setColor(EMBED_COLORS.WARNING)
            .setAuthor({ name: `${source.guild.name} · thread closed` })
            .setDescription(reason ? `Reason: ${reason}` : "Your modmail thread was closed. DM again to reopen it."),
        ],
      })
      .catch(() => {});
  }

  await channel.send(`Thread closed by <@${closedBy}>${reason ? `: ${reason}` : ""}.`).catch(() => {});
  await channel.setArchived(true).catch(() => {});

  return "Thread closed.";
}

async function block(guildId, user, blocked) {
  if (blocked) {
    const open = await getOpenThread(guildId, user.id);
    if (open) {
      await closeThread({ guildId, threadId: open.thread_id, closedBy: null, reason: "member blocked" });
    }
  }

  await setBlocked({ guildId, userId: user.id, blocked });
  return blocked ? `**${user.username}** can no longer open modmail threads.` : `**${user.username}** is unblocked.`;
}

async function listThreads(guild) {
  const threads = await listOpenThreads(guild.id);
  if (threads.length === 0) return "No open modmail threads.";

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLORS.BOT_EMBED)
    .setAuthor({ name: `Open modmail threads · ${guild.name}` })
    .setDescription(
      threads
        .map(
          (thread) =>
            `<#${thread.thread_id}> · <@${thread.user_id}> · ${thread.messages} message(s)` +
            `${thread.last_user_message_at ? ` · last member reply <t:${Math.floor(new Date(thread.last_user_message_at).getTime() / 1000)}:R>` : ""}`
        )
        .join("\n")
        .slice(0, 4000)
    );

  return { embeds: [embed] };
}

function statusEmbed(guild, settings) {
  const config = settings.modmail || {};

  return new EmbedBuilder()
    .setColor(EMBED_COLORS.BOT_EMBED)
    .setAuthor({ name: `Modmail · ${guild.name}` })
    .setDescription(
      [
        `**Status:** ${config.enabled ? "enabled" : "disabled"}`,
        `**Channel:** ${config.channel_id ? `<#${config.channel_id}>` : "not set"}`,
        `**Staff roles:** ${config.staff_roles?.length ? config.staff_roles.map((id) => `<@&${id}>`).join(", ") : "Manage Server only"}`,
        `**Anonymous replies:** ${config.anonymous ? "yes" : "no"}`,
        `**Mirror staff messages:** ${config.mirror_replies ? "yes" : "no (use /modmail reply)"}`,
      ].join("\n")
    );
}
