const { getMember } = require("@schemas/Member");
const { ApplicationCommandOptionType } = require("discord.js");
const { checkInviteRewards } = require("@handlers/invite");

/**
 * @type {import("@structures/Command")}
 */
module.exports = {
  name: "resetinvites",
  description: "clear a users added invites",
  category: "INVITE",
  userPermissions: ["ManageGuild"],
  botPermissions: ["EmbedLinks"],
  command: {
    enabled: true,
    usage: "<@member>",
    aliases: ["clearinvites"],
    minArgsCount: 1,
  },
  // The slash surface lives at /invites reset.
  slashCommand: {
    enabled: false,
    options: [
      {
        name: "user",
        description: "the user to clear invites for",
        type: ApplicationCommandOptionType.User,
        required: true,
      },
    ],
  },

  async messageRun(message, args) {
    const target = await message.guild.resolveMember(args[0], true);
    if (!target) return message.safeReply("Incorrect syntax. You must mention a target");
    const response = await clearInvites(message, target.user);
    await message.safeReply(response);
  },

  async interactionRun(interaction) {
    const user = interaction.options.getUser("user");
    const response = await clearInvites(interaction, user);
    await interaction.safeFollowUp(response);
  },
};

async function clearInvites({ guild }, user) {
  const memberDb = await getMember(guild.id, user.id);
  memberDb.invite_data.added = 0;
  await memberDb.save();
  checkInviteRewards(guild, memberDb, false);
  return `Done! Invites cleared for \`${user.username}\``;
}

module.exports.clearInvites = clearInvites;
