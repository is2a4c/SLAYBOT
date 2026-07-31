const { ApplicationCommandOptionType, ChannelType, EmbedBuilder } = require("discord.js");
const { EMBED_COLORS } = require("@root/config");
const { verificationHandler } = require("@src/handlers");
const { MAX_LENGTH, MIN_LENGTH } = require("@src/services/verification/Captcha");

/**
 * @type {import("@structures/Command")}
 */
module.exports = {
  name: "verification",
  description: "gate your server behind a verify button or a captcha",
  category: "ADMIN",
  userPermissions: ["ManageGuild"],
  botPermissions: ["ManageRoles", "EmbedLinks"],
  command: {
    enabled: true,
    aliases: ["verify"],
    usage: "<setup|config|status|off> ...",
    minArgsCount: 1,
    subcommands: [
      { trigger: "setup <#channel> <role>", description: "post the verification panel" },
      { trigger: "status", description: "show the verification configuration" },
      { trigger: "off", description: "disable verification" },
    ],
  },
  slashCommand: {
    enabled: true,
    ephemeral: true,
    options: [
      {
        name: "setup",
        description: "post the verification panel and enable verification",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "channel",
            description: "channel the panel is posted in",
            type: ApplicationCommandOptionType.Channel,
            channelTypes: [ChannelType.GuildText, ChannelType.GuildAnnouncement],
            required: true,
          },
          {
            name: "role",
            description: "role given after verification",
            type: ApplicationCommandOptionType.Role,
            required: true,
          },
          {
            name: "mode",
            description: "button only, or a captcha image",
            type: ApplicationCommandOptionType.String,
            required: false,
            choices: [
              { name: "button", value: "BUTTON" },
              { name: "captcha", value: "CAPTCHA" },
            ],
          },
          {
            name: "title",
            description: "panel title",
            type: ApplicationCommandOptionType.String,
            required: false,
          },
          {
            name: "description",
            description: "panel description",
            type: ApplicationCommandOptionType.String,
            required: false,
          },
          {
            name: "remove_role",
            description: "role taken away once verified, e.g. Unverified",
            type: ApplicationCommandOptionType.Role,
            required: false,
          },
        ],
      },
      {
        name: "config",
        description: "change the verification rules",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "mode",
            description: "button only, or a captcha image",
            type: ApplicationCommandOptionType.String,
            required: false,
            choices: [
              { name: "button", value: "BUTTON" },
              { name: "captcha", value: "CAPTCHA" },
            ],
          },
          {
            name: "captcha_length",
            description: `how many characters the code has (${MIN_LENGTH}-${MAX_LENGTH})`,
            type: ApplicationCommandOptionType.Integer,
            required: false,
            minValue: MIN_LENGTH,
            maxValue: MAX_LENGTH,
          },
          {
            name: "role",
            description: "role given after verification",
            type: ApplicationCommandOptionType.Role,
            required: false,
          },
          {
            name: "remove_role",
            description: "role taken away once verified",
            type: ApplicationCommandOptionType.Role,
            required: false,
          },
          {
            name: "log_channel",
            description: "channel that logs successful verifications",
            type: ApplicationCommandOptionType.Channel,
            channelTypes: [ChannelType.GuildText],
            required: false,
          },
          {
            name: "button_label",
            description: "text on the button",
            type: ApplicationCommandOptionType.String,
            required: false,
          },
        ],
      },
      {
        name: "status",
        description: "show the verification configuration",
        type: ApplicationCommandOptionType.Subcommand,
      },
      {
        name: "off",
        description: "disable verification",
        type: ApplicationCommandOptionType.Subcommand,
      },
    ],
  },

  async messageRun(message, args, data) {
    const sub = args[0].toLowerCase();
    const settings = data.settings;

    if (sub === "setup") {
      const channel = message.guild.findMatchingChannels(args[1])[0];
      if (!channel) return message.safeReply("Provide a valid text channel");
      const role = message.guild.findMatchingRoles(args[2])[0];
      if (!role) return message.safeReply("Provide a valid role");
      return message.safeReply(await setup(message.guild, settings, { channel, role }));
    }

    if (sub === "status") return message.safeReply({ embeds: [statusEmbed(message.guild, settings)] });

    if (sub === "off") return message.safeReply(await disable(settings));

    return message.safeReply("Invalid subcommand");
  },

  async interactionRun(interaction, data) {
    const sub = interaction.options.getSubcommand();
    const settings = data.settings;

    if (sub === "setup") {
      return interaction.safeFollowUp(
        await setup(interaction.guild, settings, {
          channel: interaction.options.getChannel("channel"),
          role: interaction.options.getRole("role"),
          mode: interaction.options.getString("mode"),
          title: interaction.options.getString("title"),
          description: interaction.options.getString("description"),
          removeRole: interaction.options.getRole("remove_role"),
        })
      );
    }

    if (sub === "config") {
      return interaction.safeFollowUp(
        await configure(interaction.guild, settings, {
          mode: interaction.options.getString("mode"),
          captchaLength: interaction.options.getInteger("captcha_length"),
          role: interaction.options.getRole("role"),
          removeRole: interaction.options.getRole("remove_role"),
          logChannel: interaction.options.getChannel("log_channel"),
          buttonLabel: interaction.options.getString("button_label"),
        })
      );
    }

    if (sub === "status") return interaction.safeFollowUp({ embeds: [statusEmbed(interaction.guild, settings)] });

    if (sub === "off") return interaction.safeFollowUp(await disable(settings));

    return interaction.safeFollowUp("Invalid subcommand");
  },
};

/**
 * @param {import('discord.js').Guild} guild
 * @param {import('discord.js').Role} role
 */
function roleProblem(guild, role) {
  if (!role) return null;
  if (role.id === guild.id) return "`@everyone` cannot be used as the verified role.";
  if (role.managed) return `${role} is managed by an integration.`;
  if (guild.members.me.roles.highest.position <= role.position) {
    return `${role} is above my highest role, so I cannot assign it.`;
  }
  return null;
}

async function setup(guild, settings, { channel, role, mode, title, description, removeRole }) {
  const problem = roleProblem(guild, role) || roleProblem(guild, removeRole);
  if (problem) return problem;

  if (!channel.permissionsFor(guild.members.me)?.has(["ViewChannel", "SendMessages", "EmbedLinks"])) {
    return `I need to view, send messages and embed links in ${channel}.`;
  }

  settings.verification.enabled = true;
  settings.verification.channel_id = channel.id;
  settings.verification.role_id = role.id;
  if (mode) settings.verification.mode = mode;
  if (title) settings.verification.title = title;
  if (description) settings.verification.description = description;
  if (removeRole) settings.verification.remove_role_id = removeRole.id;

  const panel = verificationHandler.buildPanel(settings.verification, { settings, client: guild.client });

  // Replace the previous panel so a server never ends up with two of them.
  if (settings.verification.message_id) {
    const old = guild.channels.cache.get(settings.verification.channel_id);
    await old?.messages
      ?.fetch(settings.verification.message_id)
      .then((msg) => msg.delete())
      .catch(() => {});
  }

  const message = await channel.send(panel);
  settings.verification.message_id = message.id;
  await settings.save();

  return (
    `Verification enabled in ${channel} using ${settings.verification.mode === "CAPTCHA" ? "a captcha" : "a button"}. ` +
    `Verified members get ${role}.`
  );
}

async function configure(guild, settings, changes) {
  const applied = [];

  const problem = roleProblem(guild, changes.role) || roleProblem(guild, changes.removeRole);
  if (problem) return problem;

  if (changes.mode) {
    settings.verification.mode = changes.mode;
    applied.push(`mode ${changes.mode.toLowerCase()}`);
  }
  if (changes.captchaLength) {
    settings.verification.captcha_length = changes.captchaLength;
    applied.push(`captcha length ${changes.captchaLength}`);
  }
  if (changes.role) {
    settings.verification.role_id = changes.role.id;
    applied.push(`verified role ${changes.role.name}`);
  }
  if (changes.removeRole) {
    settings.verification.remove_role_id = changes.removeRole.id;
    applied.push(`removes ${changes.removeRole.name}`);
  }
  if (changes.logChannel) {
    settings.verification.log_channel = changes.logChannel.id;
    applied.push(`log channel ${changes.logChannel.name}`);
  }
  if (changes.buttonLabel) {
    settings.verification.button_label = changes.buttonLabel.slice(0, 60);
    applied.push("button label");
  }

  if (applied.length === 0) return "Nothing to change. Provide at least one option.";

  await settings.save();

  // Keep the posted panel in sync with the new mode and label.
  if (settings.verification.channel_id && settings.verification.message_id) {
    const channel = guild.channels.cache.get(settings.verification.channel_id);
    await channel?.messages
      ?.fetch(settings.verification.message_id)
      .then((message) =>
        message.edit(verificationHandler.buildPanel(settings.verification, { settings, client: guild.client }))
      )
      .catch(() => {});
  }

  return `Verification updated: ${applied.join(", ")}.`;
}

async function disable(settings) {
  settings.verification.enabled = false;
  await settings.save();
  return "Verification disabled. The panel stays where it is but the button no longer grants a role.";
}

function statusEmbed(guild, settings) {
  const config = settings.verification || {};

  return new EmbedBuilder()
    .setColor(EMBED_COLORS.BOT_EMBED)
    .setAuthor({ name: `Verification · ${guild.name}` })
    .setDescription(
      [
        `**Status:** ${config.enabled ? "enabled" : "disabled"}`,
        `**Mode:** ${config.mode === "CAPTCHA" ? "captcha image" : "button"}`,
        `**Panel:** ${config.channel_id ? `<#${config.channel_id}>` : "not posted"}`,
        `**Verified role:** ${config.role_id ? `<@&${config.role_id}>` : "not set"}`,
        `**Removes role:** ${config.remove_role_id ? `<@&${config.remove_role_id}>` : "none"}`,
        `**Captcha length:** ${config.captcha_length || 6}`,
        `**Log channel:** ${config.log_channel ? `<#${config.log_channel}>` : "none"}`,
      ].join("\n")
    );
}
