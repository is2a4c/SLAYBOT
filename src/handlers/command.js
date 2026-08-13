const { EmbedBuilder, ApplicationCommandOptionType } = require("discord.js");
const { OWNER_IDS, PREFIX_COMMANDS, EMBED_COLORS } = require("@root/config");
const { parsePermissions } = require("@helpers/Utils");
const { timeformat } = require("@helpers/Utils");
const { getSettings } = require("@schemas/Guild");
const { effectiveCooldown, policyProblem } = require("@src/services/commands/policy");

const cooldownCache = new Map();

/**
 * Why this person cannot run this command, or null when they can.
 *
 * Shared with the control panel, which offers the same commands as buttons: the
 * rules about who may run what are decided once, so a button cannot become a way
 * around a permission a slash command enforces.
 *
 * Discord's own permissions are checked first and the server's command policy
 * after, so the policy can only ever narrow what somebody may run.
 *
 * @param {import('@structures/Command')} cmd
 * @param {Object} who
 * @param {import('discord.js').User} who.user
 * @param {import('discord.js').GuildMember} [who.member]
 * @param {import('discord.js').Guild} [who.guild]
 * @param {object} [who.settings] guild settings, when the caller has them
 * @param {import('discord.js').GuildChannel} [who.channel] where it was invoked
 * @param {"prefix"|"slash"|"panel"} [who.source]
 * @returns {string|null}
 */
function accessProblem(cmd, { user, member, guild, settings, channel, source }) {
  if (cmd.category === "OWNER" && !OWNER_IDS.includes(user?.id)) {
    return "This command is only accessible to bot owners";
  }

  if (member && cmd.userPermissions?.length > 0 && !member.permissions.has(cmd.userPermissions)) {
    return `You need ${parsePermissions(cmd.userPermissions)} for this command`;
  }

  if (cmd.botPermissions?.length > 0 && guild && !guild.members.me.permissions.has(cmd.botPermissions)) {
    return `I need ${parsePermissions(cmd.botPermissions)} for this command`;
  }

  if (settings) {
    return policyProblem(settings, cmd, {
      member,
      channelId: channel?.id,
      parentId: channel?.parentId,
      source,
    });
  }

  return null;
}

/**
 * @param {import('@structures/Command')} cmd
 * @param {string} userId
 * @param {object} [settings] guild settings, for a server's own cooldown
 * @returns {string|null}
 */
function cooldownProblem(cmd, userId, settings) {
  const cooldown = effectiveCooldown(settings, cmd);
  if (!(cooldown > 0)) return null;

  const remaining = getRemainingCooldown(userId, cmd, cooldown);
  if (remaining <= 0) return null;

  return `You are on cooldown. You can again use the command in \`${timeformat(remaining)}\``;
}

module.exports = {
  accessProblem,
  applyCooldown,
  cooldownProblem,

  /**
   * @param {import('discord.js').Message} message
   * @param {import("@structures/Command")} cmd
   * @param {object} settings
   */
  handlePrefixCommand: async function (message, cmd, settings) {
    const startedAt = Date.now();
    let succeeded = false;
    const prefix = settings.prefix;
    const args = message.content.replace(prefix, "").split(/\s+/);
    const invoke = args.shift().toLowerCase();

    const data = {};
    data.settings = settings;
    data.prefix = prefix;
    data.invoke = invoke;

    if (!message.channel.permissionsFor(message.guild.members.me).has("SendMessages")) return;

    // callback validations
    if (cmd.validations) {
      for (const validation of cmd.validations) {
        let valid;
        try {
          valid = validation.callback(message);
        } catch (ex) {
          message.client.logger.error("prefixCommandValidation", ex);
          return message.safeReply("An error occurred while validating this command");
        }
        if (!valid) {
          return message.safeReply(validation.message);
        }
      }
    }

    // Owner commands
    if (cmd.category === "OWNER" && !OWNER_IDS.includes(message.author.id)) {
      return message.safeReply("This command is only accessible to bot owners");
    }

    // check user permissions
    if (cmd.userPermissions && cmd.userPermissions?.length > 0) {
      if (!message.channel.permissionsFor(message.member).has(cmd.userPermissions)) {
        return message.safeReply(`You need ${parsePermissions(cmd.userPermissions)} for this command`);
      }
    }

    // check bot permissions
    if (cmd.botPermissions && cmd.botPermissions.length > 0) {
      if (!message.channel.permissionsFor(message.guild.members.me).has(cmd.botPermissions)) {
        return message.safeReply(`I need ${parsePermissions(cmd.botPermissions)} for this command`);
      }
    }

    // what this server allows of its own commands
    const policy = policyProblem(settings, cmd, {
      member: message.member,
      channelId: message.channelId,
      parentId: message.channel?.parentId,
      source: "prefix",
    });
    if (policy) return message.safeReply(policy);

    // minArgs count
    if (cmd.command.minArgsCount > args.length) {
      const usageEmbed = this.getCommandUsage(cmd, prefix, invoke);
      return message.safeReply({ embeds: [usageEmbed] });
    }

    // cooldown check
    const cooldown = effectiveCooldown(settings, cmd);
    if (cooldown > 0) {
      const remaining = getRemainingCooldown(message.author.id, cmd, cooldown);
      if (remaining > 0) {
        return message.safeReply(`You are on cooldown. You can again use the command in \`${timeformat(remaining)}\``);
      }
    }

    try {
      await cmd.messageRun(message, args, data);
      succeeded = true;
    } catch (ex) {
      message.client.logger.error("messageRun", ex);
      message.safeReply("An error occurred while running this command");
    } finally {
      message.client.telemetry?.recordCommand({
        guildId: message.guildId,
        userId: message.author.id,
        commandName: cmd.name,
        source: "prefix",
        success: succeeded,
        durationMs: Date.now() - startedAt,
      });
      if (cooldown > 0) applyCooldown(message.author.id, cmd);
    }
  },

  /**
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   */
  handleSlashCommand: async function (interaction) {
    const startedAt = Date.now();
    let succeeded = false;
    const cmd = interaction.client.slashCommands.get(interaction.commandName);
    if (!cmd)
      return interaction.reply({ content: "An error has occurred", ephemeral: true }).catch((ex) => {
        interaction.client.logger.error("Failed to send error response", ex);
      });

    // callback validations
    if (cmd.validations) {
      for (const validation of cmd.validations) {
        let valid;
        try {
          valid = validation.callback(interaction);
        } catch (ex) {
          interaction.client.logger.error("slashCommandValidation", ex);
          return interaction.reply({
            content: "An error occurred while validating this command",
            ephemeral: true,
          });
        }
        if (!valid) {
          return interaction.reply({
            content: validation.message,
            ephemeral: true,
          });
        }
      }
    }

    // The settings are read before the checks rather than after: the server's
    // command policy and its own cooldowns are part of who may run this.
    const settings = interaction.guild ? await getSettings(interaction.guild) : null;

    // who may run this, and whether they have waited long enough
    const problem =
      accessProblem(cmd, {
        user: interaction.user,
        member: interaction.member,
        guild: interaction.guild,
        settings,
        channel: interaction.channel,
        source: "slash",
      }) || cooldownProblem(cmd, interaction.user.id, settings);

    if (problem) return interaction.reply({ content: problem, ephemeral: true });

    try {
      // Deferring costs an extra round-trip and shows a "thinking" placeholder
      // first. A command that answers straight away can opt out and reply once.
      if (cmd.slashCommand.defer !== false && !interaction.deferred && !interaction.replied) {
        await interaction.deferReply({ ephemeral: cmd.slashCommand.ephemeral });
      }
      await cmd.interactionRun(interaction, { settings });
      succeeded = true;
    } catch (ex) {
      await respondToInteractionError(interaction, ex);
      interaction.client.logger.error("interactionRun", ex);
    } finally {
      interaction.client.telemetry?.recordCommand({
        guildId: interaction.guildId,
        userId: interaction.user.id,
        commandName: cmd.name,
        source: "slash",
        success: succeeded,
        durationMs: Date.now() - startedAt,
      });
      if (effectiveCooldown(settings, cmd) > 0) applyCooldown(interaction.user.id, cmd);
    }
  },

  /**
   * Build a usage embed for this command
   * @param {import('@structures/Command')} cmd - command object
   * @param {string} prefix - guild bot prefix
   * @param {string} invoke - alias that was used to trigger this command
   * @param {string} [title] - the embed title
   */
  getCommandUsage(cmd, prefix = PREFIX_COMMANDS.DEFAULT_PREFIX, invoke, title = "Usage") {
    let desc = "";
    if (cmd.command.subcommands && cmd.command.subcommands.length > 0) {
      cmd.command.subcommands.forEach((sub) => {
        desc += `\`${prefix}${invoke || cmd.name} ${sub.trigger}\`\n❯ ${sub.description}\n\n`;
      });
      if (cmd.cooldown) {
        desc += `**Cooldown:** ${timeformat(cmd.cooldown)}`;
      }
    } else {
      desc += `\`\`\`css\n${prefix}${invoke || cmd.name} ${cmd.command.usage}\`\`\``;
      if (cmd.description !== "") desc += `\n**Help:** ${cmd.description}`;
      if (cmd.cooldown) desc += `\n**Cooldown:** ${timeformat(cmd.cooldown)}`;
    }

    const embed = new EmbedBuilder().setColor(EMBED_COLORS.BOT_EMBED).setDescription(desc);
    if (title) embed.setAuthor({ name: title });
    return embed;
  },

  /**
   * @param {import('@structures/Command')} cmd - command object
   */
  getSlashUsage(cmd) {
    let desc = "";
    const options = cmd.slashCommand.options || [];
    const hasSubcommand = options.some((o) => o.type === ApplicationCommandOptionType.Subcommand);
    const hasGroup = options.some((o) => o.type === ApplicationCommandOptionType.SubcommandGroup);

    if (hasGroup) {
      options
        .filter((opt) => opt.type === ApplicationCommandOptionType.SubcommandGroup)
        .forEach((group) => {
          (group.options || []).forEach((sub) => {
            desc += `\`/${cmd.name} ${group.name} ${sub.name}\`\n❯ ${sub.description}\n\n`;
          });
        });
      options
        .filter((opt) => opt.type === ApplicationCommandOptionType.Subcommand)
        .forEach((sub) => {
          desc += `\`/${cmd.name} ${sub.name}\`\n❯ ${sub.description}\n\n`;
        });
    } else if (hasSubcommand) {
      const subCmds = options.filter((opt) => opt.type === ApplicationCommandOptionType.Subcommand);
      subCmds.forEach((sub) => {
        desc += `\`/${cmd.name} ${sub.name}\`\n❯ ${sub.description}\n\n`;
      });
    } else {
      desc += `\`/${cmd.name}\`\n\n**Help:** ${cmd.description}`;
    }

    if (cmd.cooldown) {
      desc += `\n**Cooldown:** ${timeformat(cmd.cooldown)}`;
    }

    return new EmbedBuilder().setColor(EMBED_COLORS.BOT_EMBED).setDescription(desc);
  },
};

/**
 * @param {string} memberId
 * @param {object} cmd
 */
function applyCooldown(memberId, cmd) {
  const key = cmd.name + "|" + memberId;
  cooldownCache.set(key, Date.now());
}

/**
 * @param {string} memberId
 * @param {object} cmd
 * @param {number} [cooldown] seconds, when a server set its own
 */
function getRemainingCooldown(memberId, cmd, cooldown = Number(cmd.cooldown || 0)) {
  const key = cmd.name + "|" + memberId;
  if (cooldownCache.has(key)) {
    const elapsed = (Date.now() - cooldownCache.get(key)) * 0.001;
    if (elapsed > cooldown) {
      cooldownCache.delete(key);
      return 0;
    }
    return cooldown - elapsed;
  }
  return 0;
}

/**
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
async function respondToInteractionError(interaction, error) {
  await interaction.safeFollowUp({
    content: error?.safeMessage || "Oops! An error occurred while running the command",
    ephemeral: true,
  });
}
