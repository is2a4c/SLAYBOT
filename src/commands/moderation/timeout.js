const { timeoutTarget, getPunishmentInfo } = require("@helpers/ModUtils");
const { ApplicationCommandOptionType } = require("discord.js");
const ems = require("enhanced-ms");

/**
 * @type {import("@structures/Command")}
 */
module.exports = {
  name: "timeout",
  description: "timeouts the specified member",
  category: "MODERATION",
  botPermissions: ["ModerateMembers"],
  userPermissions: ["ModerateMembers"],
  command: {
    enabled: true,
    aliases: ["mute"],
    usage: "<ID|@member> <duration> [reason]",
    minArgsCount: 2,
  },
  slashCommand: {
    enabled: true,
    options: [
      {
        name: "user",
        description: "the target member",
        type: ApplicationCommandOptionType.User,
        required: true,
      },
      {
        name: "duration",
        description: "the time to timeout the member for",
        type: ApplicationCommandOptionType.String,
        required: true,
      },
      {
        name: "reason",
        description: "reason for timeout",
        type: ApplicationCommandOptionType.String,
        required: false,
      },
    ],
  },

  async messageRun(message, args) {
    const target = await message.guild.resolveMember(args[0], true);
    if (!target) return message.safeReply(`No user found matching ${args[0]}`);

    const ms = ems(args[1]);
    if (!ms) return message.safeReply("Please provide a valid duration. Example: 1d/1h/1m/1s");

    const reason = args.slice(2).join(" ").trim();
    const response = await timeout(message.member, target, ms, reason);
    await message.safeReply(response);
  },

  async interactionRun(interaction) {
    const user = interaction.options.getUser("user");

    const duration = interaction.options.getString("duration");
    const ms = ems(duration);
    if (!ms) return interaction.safeFollowUp("Please provide a valid duration. Example: 1d/1h/1m/1s");

    const reason = interaction.options.getString("reason");
    const target = await interaction.guild.members.fetch(user.id);

    const response = await timeout(interaction.member, target, ms, reason);
    await interaction.safeFollowUp(response);
  },
};

async function timeout(issuer, target, ms, reason) {
  if (isNaN(ms)) return "Please provide a valid duration. Example: 1d/1h/1m/1s";
  const response = await timeoutTarget(issuer, target, ms, reason);
  if (typeof response !== "boolean") {
    if (response === "BOT_PERM") return `I do not have permission to timeout ${target.user.username}`;
    if (response === "MEMBER_PERM") return `You do not have permission to timeout ${target.user.username}`;
    if (response === "ALREADY_TIMEOUT") return `${target.user.username} is already muted!`;
    if (response === "NO_MUTE_ROLE") return "This server's mute mode needs a mute role, but none is configured yet.";
    return `Failed to timeout ${target.user.username}`;
  }

  const info = await getPunishmentInfo(issuer.guild, target);
  let msg = `${target.user.username} is timed out!`;
  msg += `\n📊 Предупреждений: **${info.warnings}/${info.maxWarn}**`;

  if (info.isLastWarning) {
    msg += `\n⚠️ **Это последнее предупреждение!** Следующее → ${info.nextAction}`;
  }

  return msg;
}
