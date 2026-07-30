const { ApplicationCommandOptionType, ChannelType, EmbedBuilder, time } = require("discord.js");
const ems = require("enhanced-ms");
const { EMBED_COLORS } = require("@root/config");
const {
  MAX_PANEL_ROLES,
  createPanel,
  deletePanel,
  findPanel,
  listPanels,
  updatePanel,
} = require("@schemas/SelfRolePanel");
const { SelfRoleError, assertAssignable, buildPanelEmbed, resolveComponentEmoji } = require("@helpers/SelfRoles");
const { commandHandler, selfRoleHandler } = require("@src/handlers");
const { TempRoleError, cancelTempRole, grantTempRole, listTempRoles } = require("@src/services/roles/TempRoles");
const { clearGuildRoles, getMemberRoles } = require("@schemas/MemberRoles");
const { addRR } = require("./reaction-role/addrr");
const { removeRR } = require("./reaction-role/removerr");
const { setReactionRoles } = require("./reaction-role/setrr");

const MAX_VOICE_ROLE_CHANNELS = 25;

/**
 * @type {import("@structures/Command")}
 */
module.exports = {
  name: "roles",
  description: "reaction roles, self role panels, temporary roles, voice roles and role restore",
  category: "ADMIN",
  userPermissions: ["ManageGuild"],
  botPermissions: ["ManageRoles", "EmbedLinks"],
  command: {
    enabled: true,
    usage: "<self|temp|voice|restore|reaction> ...",
    minArgsCount: 1,
    subcommands: [
      { trigger: "self list", description: "list the self role panels of this server" },
      { trigger: "temp add <user> <role> <duration> [reason]", description: "give a role that expires by itself" },
      { trigger: "temp remove <user> <role>", description: "remove a temporary role right away" },
      { trigger: "temp list [user]", description: "list the temporary roles that are still running" },
      { trigger: "voice set <channel|any> <role>", description: "give a role while a member is in that channel" },
      { trigger: "voice unset <channel|any>", description: "stop giving a role for that channel" },
      { trigger: "voice list", description: "show the voice role configuration" },
      { trigger: "restore <on|off>", description: "give roles back when a member rejoins" },
    ],
  },
  // The reaction-role prefix commands (!addrr, !setrr, !removerr) still exist; their
  // slash surface was folded in here to stay under Discord's 100 slash command cap.
  slashCommand: {
    enabled: true,
    ephemeral: true,
    options: [
      {
        name: "self",
        description: "self assignable role panels",
        type: ApplicationCommandOptionType.SubcommandGroup,
        options: [
          {
            name: "create",
            description: "post a new self role panel",
            type: ApplicationCommandOptionType.Subcommand,
            options: [
              {
                name: "name",
                description: "short name used to reference this panel later",
                type: ApplicationCommandOptionType.String,
                required: true,
              },
              {
                name: "channel",
                description: "channel to post the panel in",
                type: ApplicationCommandOptionType.Channel,
                channelTypes: [ChannelType.GuildText, ChannelType.GuildAnnouncement],
                required: true,
              },
              {
                name: "style",
                description: "buttons or a dropdown",
                type: ApplicationCommandOptionType.String,
                required: false,
                choices: [
                  { name: "buttons", value: "BUTTON" },
                  { name: "dropdown", value: "SELECT" },
                ],
              },
              {
                name: "title",
                description: "embed title",
                type: ApplicationCommandOptionType.String,
                required: false,
              },
              {
                name: "description",
                description: "embed description",
                type: ApplicationCommandOptionType.String,
                required: false,
              },
            ],
          },
          {
            name: "add",
            description: "add a role to a panel",
            type: ApplicationCommandOptionType.Subcommand,
            options: [
              {
                name: "panel",
                description: "panel name or message id",
                type: ApplicationCommandOptionType.String,
                required: true,
              },
              {
                name: "role",
                description: "role members can pick",
                type: ApplicationCommandOptionType.Role,
                required: true,
              },
              {
                name: "label",
                description: "button or option label (defaults to the role name)",
                type: ApplicationCommandOptionType.String,
                required: false,
              },
              {
                name: "emoji",
                description: "emoji shown next to the label",
                type: ApplicationCommandOptionType.String,
                required: false,
              },
              {
                name: "description",
                description: "dropdown option description",
                type: ApplicationCommandOptionType.String,
                required: false,
              },
            ],
          },
          {
            name: "remove",
            description: "remove a role from a panel",
            type: ApplicationCommandOptionType.Subcommand,
            options: [
              {
                name: "panel",
                description: "panel name or message id",
                type: ApplicationCommandOptionType.String,
                required: true,
              },
              {
                name: "role",
                description: "role to remove from the panel",
                type: ApplicationCommandOptionType.Role,
                required: true,
              },
            ],
          },
          {
            name: "config",
            description: "change the rules of a panel",
            type: ApplicationCommandOptionType.Subcommand,
            options: [
              {
                name: "panel",
                description: "panel name or message id",
                type: ApplicationCommandOptionType.String,
                required: true,
              },
              {
                name: "max_roles",
                description: "how many roles a member may hold (0 = no limit)",
                type: ApplicationCommandOptionType.Integer,
                required: false,
                minValue: 0,
                maxValue: MAX_PANEL_ROLES,
              },
              {
                name: "unique",
                description: "only one role at a time (colour roles)",
                type: ApplicationCommandOptionType.Boolean,
                required: false,
              },
              {
                name: "allow_remove",
                description: "let members take roles off again",
                type: ApplicationCommandOptionType.Boolean,
                required: false,
              },
              {
                name: "required_role",
                description: "role needed to use the panel",
                type: ApplicationCommandOptionType.Role,
                required: false,
              },
              {
                name: "title",
                description: "embed title",
                type: ApplicationCommandOptionType.String,
                required: false,
              },
              {
                name: "description",
                description: "embed description",
                type: ApplicationCommandOptionType.String,
                required: false,
              },
              {
                name: "placeholder",
                description: "dropdown placeholder",
                type: ApplicationCommandOptionType.String,
                required: false,
              },
            ],
          },
          {
            name: "list",
            description: "list the self role panels of this server",
            type: ApplicationCommandOptionType.Subcommand,
          },
          {
            name: "delete",
            description: "delete a panel and its message",
            type: ApplicationCommandOptionType.Subcommand,
            options: [
              {
                name: "panel",
                description: "panel name or message id",
                type: ApplicationCommandOptionType.String,
                required: true,
              },
            ],
          },
        ],
      },
      {
        name: "temp",
        description: "roles that expire on their own",
        type: ApplicationCommandOptionType.SubcommandGroup,
        options: [
          {
            name: "add",
            description: "give a role for a limited time",
            type: ApplicationCommandOptionType.Subcommand,
            options: [
              {
                name: "user",
                description: "member receiving the role",
                type: ApplicationCommandOptionType.User,
                required: true,
              },
              {
                name: "role",
                description: "role to grant",
                type: ApplicationCommandOptionType.Role,
                required: true,
              },
              {
                name: "duration",
                description: "how long the role lasts, e.g. 2h, 30m, 7d",
                type: ApplicationCommandOptionType.String,
                required: true,
              },
              {
                name: "reason",
                description: "why the role was granted",
                type: ApplicationCommandOptionType.String,
                required: false,
              },
            ],
          },
          {
            name: "remove",
            description: "remove a temporary role now",
            type: ApplicationCommandOptionType.Subcommand,
            options: [
              {
                name: "user",
                description: "member holding the role",
                type: ApplicationCommandOptionType.User,
                required: true,
              },
              {
                name: "role",
                description: "role to remove",
                type: ApplicationCommandOptionType.Role,
                required: true,
              },
            ],
          },
          {
            name: "list",
            description: "list temporary roles that have not expired yet",
            type: ApplicationCommandOptionType.Subcommand,
            options: [
              {
                name: "user",
                description: "only show this member",
                type: ApplicationCommandOptionType.User,
                required: false,
              },
            ],
          },
        ],
      },
      {
        name: "voice",
        description: "roles handed out while a member is in voice",
        type: ApplicationCommandOptionType.SubcommandGroup,
        options: [
          {
            name: "set",
            description: "give a role while a member is in a voice channel",
            type: ApplicationCommandOptionType.Subcommand,
            options: [
              {
                name: "role",
                description: "role to hand out",
                type: ApplicationCommandOptionType.Role,
                required: true,
              },
              {
                name: "channel",
                description: "voice channel (leave empty for any voice channel)",
                type: ApplicationCommandOptionType.Channel,
                channelTypes: [ChannelType.GuildVoice, ChannelType.GuildStageVoice],
                required: false,
              },
            ],
          },
          {
            name: "unset",
            description: "stop handing out a role for a channel",
            type: ApplicationCommandOptionType.Subcommand,
            options: [
              {
                name: "channel",
                description: "voice channel (leave empty for the any-channel role)",
                type: ApplicationCommandOptionType.Channel,
                channelTypes: [ChannelType.GuildVoice, ChannelType.GuildStageVoice],
                required: false,
              },
            ],
          },
          {
            name: "list",
            description: "show the voice role configuration",
            type: ApplicationCommandOptionType.Subcommand,
          },
        ],
      },
      {
        name: "reaction",
        description: "roles given for reacting to a message",
        type: ApplicationCommandOptionType.SubcommandGroup,
        options: [
          {
            name: "add",
            description: "add one emoji-role pair to a message",
            type: ApplicationCommandOptionType.Subcommand,
            options: [
              {
                name: "channel",
                description: "channel where the message exists",
                type: ApplicationCommandOptionType.Channel,
                channelTypes: [ChannelType.GuildText, ChannelType.GuildAnnouncement],
                required: true,
              },
              {
                name: "message_id",
                description: "message to configure",
                type: ApplicationCommandOptionType.String,
                required: true,
              },
              {
                name: "emoji",
                description: "emoji members react with",
                type: ApplicationCommandOptionType.String,
                required: true,
              },
              {
                name: "role",
                description: "role given for that emoji",
                type: ApplicationCommandOptionType.Role,
                required: true,
              },
            ],
          },
          {
            name: "set",
            description: "replace every emoji-role pair of a message at once",
            type: ApplicationCommandOptionType.Subcommand,
            options: [
              {
                name: "channel",
                description: "channel where the message exists",
                type: ApplicationCommandOptionType.Channel,
                channelTypes: [ChannelType.GuildText, ChannelType.GuildAnnouncement],
                required: true,
              },
              {
                name: "message_id",
                description: "message to configure",
                type: ApplicationCommandOptionType.String,
                required: true,
              },
              {
                name: "pairs",
                description: "pairs such as: 😀 @Member, 🎮 @Gamer",
                type: ApplicationCommandOptionType.String,
                required: true,
              },
            ],
          },
          {
            name: "remove",
            description: "remove every reaction role of a message",
            type: ApplicationCommandOptionType.Subcommand,
            options: [
              {
                name: "channel",
                description: "channel where the message exists",
                type: ApplicationCommandOptionType.Channel,
                channelTypes: [ChannelType.GuildText, ChannelType.GuildAnnouncement],
                required: true,
              },
              {
                name: "message_id",
                description: "message to clear",
                type: ApplicationCommandOptionType.String,
                required: true,
              },
            ],
          },
        ],
      },
      {
        name: "restore",
        description: "give roles back when a member rejoins",
        type: ApplicationCommandOptionType.SubcommandGroup,
        options: [
          {
            name: "config",
            description: "configure role restore",
            type: ApplicationCommandOptionType.Subcommand,
            options: [
              {
                name: "status",
                description: "turn role restore on or off",
                type: ApplicationCommandOptionType.String,
                required: true,
                choices: [
                  { name: "on", value: "ON" },
                  { name: "off", value: "OFF" },
                ],
              },
              {
                name: "retention_days",
                description: "how long a snapshot is kept (1-365 days)",
                type: ApplicationCommandOptionType.Integer,
                required: false,
                minValue: 1,
                maxValue: 365,
              },
              {
                name: "include_privileged",
                description: "also restore roles with moderation permissions",
                type: ApplicationCommandOptionType.Boolean,
                required: false,
              },
            ],
          },
          {
            name: "status",
            description: "show the current role restore configuration",
            type: ApplicationCommandOptionType.Subcommand,
          },
          {
            name: "check",
            description: "show the stored snapshot for a member",
            type: ApplicationCommandOptionType.Subcommand,
            options: [
              {
                name: "user",
                description: "member to look up",
                type: ApplicationCommandOptionType.User,
                required: true,
              },
            ],
          },
          {
            name: "purge",
            description: "delete every stored role snapshot of this server",
            type: ApplicationCommandOptionType.Subcommand,
          },
        ],
      },
    ],
  },

  async messageRun(message, args, data) {
    const group = args[0]?.toLowerCase();
    const sub = args[1]?.toLowerCase();
    const rest = args.slice(2);

    try {
      if (group === "self" && sub === "list") {
        return message.safeReply(await selfList(message.guild));
      }

      if (group === "temp") {
        if (sub === "add") {
          const member = await message.guild.resolveMember(rest[0], true);
          if (!member) return message.safeReply("Provide a valid member");
          const role = message.guild.findMatchingRoles(rest[1])[0];
          if (!role) return message.safeReply("Provide a valid role");
          return message.safeReply(await tempAdd(member, role, rest[2], rest.slice(3).join(" "), message.author.id));
        }
        if (sub === "remove") {
          const member = await message.guild.resolveMember(rest[0], true);
          if (!member) return message.safeReply("Provide a valid member");
          const role = message.guild.findMatchingRoles(rest[1])[0];
          if (!role) return message.safeReply("Provide a valid role");
          return message.safeReply(await tempRemove(member, role));
        }
        if (sub === "list") {
          const member = rest[0] ? await message.guild.resolveMember(rest[0], true) : null;
          return message.safeReply(await tempList(message.guild, member?.id));
        }
      }

      if (group === "voice") {
        if (sub === "set") {
          const channel = isAny(rest[0]) ? null : message.guild.findMatchingVoiceChannels(rest[0])[0];
          if (!isAny(rest[0]) && !channel) return message.safeReply("Provide a valid voice channel or `any`");
          const role = message.guild.findMatchingRoles(rest[1])[0];
          if (!role) return message.safeReply("Provide a valid role");
          return message.safeReply(await voiceSet(message.guild, data.settings, channel, role));
        }
        if (sub === "unset") {
          const channel = isAny(rest[0]) ? null : message.guild.findMatchingVoiceChannels(rest[0])[0];
          if (!isAny(rest[0]) && !channel) return message.safeReply("Provide a valid voice channel or `any`");
          return message.safeReply(await voiceUnset(data.settings, channel));
        }
        if (sub === "list") {
          return message.safeReply({ embeds: [voiceList(data.settings)] });
        }
      }

      if (group === "restore") {
        if (sub === "on" || sub === "off") {
          return message.safeReply(await restoreConfig(data.settings, sub === "on"));
        }
        if (sub === "status" || !sub) {
          return message.safeReply({ embeds: [restoreStatus(data.settings)] });
        }
      }
    } catch (ex) {
      if (ex instanceof SelfRoleError || ex instanceof TempRoleError) return message.safeReply(ex.message);
      throw ex;
    }

    return message.safeReply({
      embeds: [commandHandler.getCommandUsage(module.exports, data.prefix, data.invoke)],
    });
  },

  async interactionRun(interaction, data) {
    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand();

    try {
      if (group === "self") return interaction.followUp(await runSelf(interaction, sub, data.settings));
      if (group === "temp") return interaction.followUp(await runTemp(interaction, sub));
      if (group === "voice") return interaction.followUp(await runVoice(interaction, sub, data.settings));
      if (group === "restore") return interaction.followUp(await runRestore(interaction, sub, data.settings));
      if (group === "reaction") return interaction.followUp(await runReaction(interaction, sub));
    } catch (ex) {
      if (ex instanceof SelfRoleError || ex instanceof TempRoleError) return interaction.followUp(ex.message);
      throw ex;
    }

    return interaction.followUp("Invalid subcommand");
  },
};

function isAny(value) {
  return !value || ["any", "all", "*"].includes(String(value).toLowerCase());
}

/* -------------------------------------------------------------- reaction roles */

async function runReaction(interaction, sub) {
  const guild = interaction.guild;
  const channel = interaction.options.getChannel("channel");
  const messageId = interaction.options.getString("message_id");

  if (sub === "add") {
    return addRR(
      guild,
      channel,
      messageId,
      interaction.options.getString("emoji"),
      interaction.options.getRole("role")
    );
  }
  if (sub === "set") {
    return setReactionRoles(guild, channel, messageId, interaction.options.getString("pairs"));
  }
  if (sub === "remove") {
    return removeRR(guild, channel, messageId);
  }

  return "Invalid subcommand";
}

/* ------------------------------------------------------------------ self roles */

async function runSelf(interaction, sub, settings) {
  const guild = interaction.guild;

  if (sub === "create") {
    const name = interaction.options.getString("name").trim().slice(0, 60);
    const channel = interaction.options.getChannel("channel");
    const style = interaction.options.getString("style") || "BUTTON";

    if (await findPanel(guild.id, name)) return `A panel named \`${name}\` already exists.`;
    if (!channel.permissionsFor(guild.members.me).has(["ViewChannel", "SendMessages", "EmbedLinks"])) {
      return `I need to view, send messages and embed links in ${channel}.`;
    }

    const draft = {
      guild_id: guild.id,
      channel_id: channel.id,
      message_id: "pending",
      name,
      style,
      title: interaction.options.getString("title") || name,
      description: interaction.options.getString("description") || "",
      roles: [],
    };

    const message = await channel.send({
      embeds: [buildPanelEmbed(draft, { settings, client: interaction.client })],
    });
    const panel = await createPanel({ ...draft, message_id: message.id });

    return `Panel \`${panel.name}\` created in ${channel}. Add roles with \`/roles self add panel:${panel.name}\`.`;
  }

  const panel = await findPanel(guild.id, interaction.options.getString("panel"));
  if (sub !== "list" && !panel) return "No panel found with that name or message id.";

  if (sub === "add") {
    const role = assertAssignable(guild, interaction.options.getRole("role"));
    if (panel.roles.length >= MAX_PANEL_ROLES) return `A panel can hold at most ${MAX_PANEL_ROLES} roles.`;
    if (panel.roles.some((entry) => entry.role_id === role.id)) return `${role} is already on this panel.`;

    const emoji = resolveComponentEmoji(interaction.options.getString("emoji"), guild);
    const updated = await updatePanel(guild.id, panel.message_id, {
      $push: {
        roles: {
          role_id: role.id,
          label: (interaction.options.getString("label") || role.name).slice(0, 80),
          emoji,
          description: interaction.options.getString("description") || null,
        },
      },
    });

    const rendered = await selfRoleHandler.refreshPanel(interaction.client, updated);
    return `${role} added to \`${updated.name}\`.${rendered ? "" : " The panel message is missing, so it was not updated."}`;
  }

  if (sub === "remove") {
    const role = interaction.options.getRole("role");
    if (!panel.roles.some((entry) => entry.role_id === role.id)) return `${role} is not on this panel.`;

    const updated = await updatePanel(guild.id, panel.message_id, { $pull: { roles: { role_id: role.id } } });
    await selfRoleHandler.refreshPanel(interaction.client, updated);
    return `${role} removed from \`${updated.name}\`.`;
  }

  if (sub === "config") {
    const set = {};
    const maxRoles = interaction.options.getInteger("max_roles");
    const unique = interaction.options.getBoolean("unique");
    const allowRemove = interaction.options.getBoolean("allow_remove");
    const requiredRole = interaction.options.getRole("required_role");
    const title = interaction.options.getString("title");
    const description = interaction.options.getString("description");
    const placeholder = interaction.options.getString("placeholder");

    if (maxRoles !== null) set.max_roles = maxRoles;
    if (unique !== null) set.unique = unique;
    if (allowRemove !== null) set.allow_remove = allowRemove;
    if (requiredRole) set.required_role = requiredRole.id;
    if (title) set.title = title;
    if (description !== null) set.description = description;
    if (placeholder) set.placeholder = placeholder;

    if (Object.keys(set).length === 0) return "Nothing to change. Provide at least one option.";

    const updated = await updatePanel(guild.id, panel.message_id, { $set: set });
    await selfRoleHandler.refreshPanel(interaction.client, updated);
    return `Panel \`${updated.name}\` updated.`;
  }

  if (sub === "list") return selfList(guild);

  if (sub === "delete") {
    const channel = await interaction.client.channels.fetch(panel.channel_id).catch(() => null);
    const message = channel?.isTextBased() ? await channel.messages.fetch(panel.message_id).catch(() => null) : null;
    if (message) await message.delete().catch(() => {});

    await deletePanel(guild.id, panel.message_id);
    return `Panel \`${panel.name}\` deleted.`;
  }

  return "Invalid subcommand";
}

async function selfList(guild) {
  const panels = await listPanels(guild.id);
  if (panels.length === 0) return "This server has no self role panels yet.";

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLORS.BOT_EMBED)
    .setAuthor({ name: `Self role panels · ${guild.name}` })
    .setDescription(
      panels
        .map(
          (panel) =>
            `**${panel.name}** · ${panel.style === "SELECT" ? "dropdown" : "buttons"} · <#${panel.channel_id}>\n` +
            `-# ${panel.roles.length} role${panel.roles.length === 1 ? "" : "s"} · message \`${panel.message_id}\`` +
            `${panel.unique ? " · unique" : panel.max_roles ? ` · max ${panel.max_roles}` : ""}`
        )
        .join("\n\n")
        .slice(0, 4000)
    );

  return { embeds: [embed] };
}

/* ----------------------------------------------------------------- temp roles */

async function runTemp(interaction, sub) {
  const guild = interaction.guild;

  if (sub === "add") {
    const user = interaction.options.getUser("user");
    const member = await guild.members.fetch(user.id).catch(() => null);
    if (!member) return "That member is not in this server.";
    return tempAdd(
      member,
      interaction.options.getRole("role"),
      interaction.options.getString("duration"),
      interaction.options.getString("reason"),
      interaction.user.id
    );
  }

  if (sub === "remove") {
    const user = interaction.options.getUser("user");
    const member = await guild.members.fetch(user.id).catch(() => null);
    if (!member) return "That member is not in this server.";
    return tempRemove(member, interaction.options.getRole("role"));
  }

  if (sub === "list") {
    return tempList(guild, interaction.options.getUser("user")?.id);
  }

  return "Invalid subcommand";
}

async function tempAdd(member, role, duration, reason, moderatorId) {
  const durationMs = ems(duration || "");
  const { expiresAt, alreadyHeld } = await grantTempRole({
    member,
    role,
    durationMs,
    reason: reason || undefined,
    moderatorId,
  });

  return (
    `${alreadyHeld ? "Expiry set for" : "Granted"} ${role} to **${member.user.username}**. ` +
    `It is removed ${time(expiresAt, "R")} (${time(expiresAt, "f")}).`
  );
}

async function tempRemove(member, role) {
  const cancelled = await cancelTempRole({ guildId: member.guild.id, userId: member.id, roleId: role.id });
  const held = member.roles.cache.has(role.id);

  if (held) await member.roles.remove(role, "Temporary role removed early").catch(() => {});
  if (!cancelled && !held) return `**${member.user.username}** does not have a temporary ${role}.`;

  return `Removed ${role} from **${member.user.username}**${cancelled ? " and cancelled its expiry" : ""}.`;
}

async function tempList(guild, userId) {
  const tasks = await listTempRoles({ guildId: guild.id, userId });
  if (tasks.length === 0) return userId ? "That member has no temporary roles." : "No temporary roles are running.";

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLORS.BOT_EMBED)
    .setAuthor({ name: `Temporary roles · ${guild.name}` })
    .setDescription(
      tasks
        .map(
          (task) =>
            `<@${task.payload.userId}> · <@&${task.payload.roleId}> · expires ${time(new Date(task.run_at), "R")}` +
            `${task.payload.reason ? `\n-# ${task.payload.reason}` : ""}`
        )
        .join("\n")
        .slice(0, 4000)
    );

  return { embeds: [embed] };
}

/* ---------------------------------------------------------------- voice roles */

async function runVoice(interaction, sub, settings) {
  if (sub === "set") {
    return voiceSet(
      interaction.guild,
      settings,
      interaction.options.getChannel("channel"),
      interaction.options.getRole("role")
    );
  }
  if (sub === "unset") return voiceUnset(settings, interaction.options.getChannel("channel"));
  if (sub === "list") return { embeds: [voiceList(settings)] };
  return "Invalid subcommand";
}

async function voiceSet(guild, settings, channel, role) {
  assertAssignable(guild, role);

  settings.voice_roles.enabled = true;

  if (!channel) {
    settings.voice_roles.default_role = role.id;
    await settings.save();
    return `${role} is now given to everyone in a voice channel.`;
  }

  const existing = settings.voice_roles.channels.find((entry) => entry.channel_id === channel.id);
  if (existing) {
    existing.role_id = role.id;
  } else {
    if (settings.voice_roles.channels.length >= MAX_VOICE_ROLE_CHANNELS) {
      return `At most ${MAX_VOICE_ROLE_CHANNELS} channels can have a voice role.`;
    }
    settings.voice_roles.channels.push({ channel_id: channel.id, role_id: role.id });
  }

  await settings.save();
  return `${role} is now given while a member is in ${channel}.`;
}

async function voiceUnset(settings, channel) {
  if (!channel) {
    if (!settings.voice_roles.default_role) return "No any-channel voice role is configured.";
    settings.voice_roles.default_role = null;
  } else {
    const before = settings.voice_roles.channels.length;
    settings.voice_roles.channels = settings.voice_roles.channels.filter((entry) => entry.channel_id !== channel.id);
    if (settings.voice_roles.channels.length === before) return `${channel} has no voice role configured.`;
  }

  if (!settings.voice_roles.default_role && settings.voice_roles.channels.length === 0) {
    settings.voice_roles.enabled = false;
  }

  await settings.save();
  return channel ? `Voice role for ${channel} removed.` : "Any-channel voice role removed.";
}

function voiceList(settings) {
  const config = settings.voice_roles || {};
  const lines = [];

  lines.push(`**Status:** ${config.enabled ? "enabled" : "disabled"}`);
  lines.push(`**Any voice channel:** ${config.default_role ? `<@&${config.default_role}>` : "not set"}`);

  if (config.channels?.length) {
    lines.push("", ...config.channels.map((entry) => `<#${entry.channel_id}> → <@&${entry.role_id}>`));
  } else {
    lines.push("", "_No per-channel voice roles configured._");
  }

  return new EmbedBuilder()
    .setColor(EMBED_COLORS.BOT_EMBED)
    .setAuthor({ name: "Voice roles" })
    .setDescription(lines.join("\n"));
}

/* -------------------------------------------------------------- restore roles */

async function runRestore(interaction, sub, settings) {
  if (sub === "config") {
    return restoreConfig(
      settings,
      interaction.options.getString("status") === "ON",
      interaction.options.getInteger("retention_days"),
      interaction.options.getBoolean("include_privileged")
    );
  }

  if (sub === "status") return { embeds: [restoreStatus(settings)] };

  if (sub === "check") {
    const user = interaction.options.getUser("user");
    const snapshot = await getMemberRoles(interaction.guildId, user.id);
    if (!snapshot?.roles?.length) return `No stored roles for **${user.username}**.`;

    return (
      `**${user.username}** has ${snapshot.roles.length} stored role${snapshot.roles.length === 1 ? "" : "s"}: ` +
      `${snapshot.roles.map((id) => `<@&${id}>`).join(", ")}\n-# saved ${time(new Date(snapshot.saved_at), "R")}`
    );
  }

  if (sub === "purge") {
    const result = await clearGuildRoles(interaction.guildId);
    return `Deleted ${result.deletedCount || 0} stored role snapshot(s).`;
  }

  return "Invalid subcommand";
}

async function restoreConfig(settings, enabled, retentionDays, includePrivileged) {
  settings.restore_roles.enabled = enabled;
  if (retentionDays) settings.restore_roles.retention_days = retentionDays;
  if (includePrivileged !== null && includePrivileged !== undefined) {
    settings.restore_roles.include_privileged = includePrivileged;
  }
  await settings.save();

  return enabled
    ? `Role restore enabled. Snapshots are kept for ${settings.restore_roles.retention_days} days` +
        `${settings.restore_roles.include_privileged ? ", including privileged roles" : ""}.`
    : "Role restore disabled. Existing snapshots are kept until they expire.";
}

function restoreStatus(settings) {
  const config = settings.restore_roles || {};
  return new EmbedBuilder()
    .setColor(EMBED_COLORS.BOT_EMBED)
    .setAuthor({ name: "Role restore" })
    .setDescription(
      [
        `**Status:** ${config.enabled ? "enabled" : "disabled"}`,
        `**Snapshot retention:** ${config.retention_days || 90} days`,
        `**Privileged roles:** ${config.include_privileged ? "restored" : "skipped"}`,
      ].join("\n")
    );
}
