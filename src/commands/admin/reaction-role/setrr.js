const { applyReactionRoles } = require("@src/services/roles/ReactionRoleSetup");
const { guildTranslator } = require("@src/i18n");
const { ApplicationCommandOptionType, ChannelType } = require("discord.js");

/**
 * @type {import("@structures/Command")}
 */
module.exports = {
  name: "setrr",
  description: "configure all reaction roles for a message at once",
  category: "ADMIN",
  userPermissions: ["ManageGuild"],
  command: {
    enabled: true,
    usage: "<#channel> <messageId> <emoji @role, emoji @role ...>",
    minArgsCount: 3,
  },
  // The slash surface lives at /roles reaction set.
  slashCommand: {
    enabled: false,
    ephemeral: true,
    options: [
      {
        name: "channel",
        description: "channel where the message exists",
        type: ApplicationCommandOptionType.Channel,
        channelTypes: [ChannelType.GuildText],
        required: true,
      },
      {
        name: "message_id",
        description: "message id to configure",
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

  async messageRun(message, args, data) {
    const t = guildTranslator(data?.settings, message.guild);
    const targetChannels = message.guild.findMatchingChannels(args[0]);
    if (targetChannels.length === 0) return message.safeReply(t("reactionRoles.channelNotFound", { name: args[0] }));

    const result = await applyReactionRoles(message.guild, targetChannels[0], args[1], args.slice(2).join(" "));
    await message.safeReply(t(result.key, result.vars));
  },

  async interactionRun(interaction, data) {
    const t = guildTranslator(data?.settings, interaction.guild);
    const result = await applyReactionRoles(
      interaction.guild,
      interaction.options.getChannel("channel"),
      interaction.options.getString("message_id"),
      interaction.options.getString("pairs")
    );
    await interaction.safeFollowUp(t(result.key, result.vars));
  },
};

module.exports.setReactionRoles = applyReactionRoles;
