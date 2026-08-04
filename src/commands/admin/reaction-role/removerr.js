const { removeReactionRole } = require("@schemas/ReactionRoles");
const { parsePermissions } = require("@helpers/Utils");
const { guildTranslator } = require("@src/i18n");
const { ApplicationCommandOptionType, ChannelType } = require("discord.js");

const channelPerms = ["EmbedLinks", "ReadMessageHistory", "AddReactions", "UseExternalEmojis", "ManageMessages"];

/**
 * @type {import("@structures/Command")}
 */
module.exports = {
  name: "removerr",
  description: "remove configured reaction for the specified message",
  category: "ADMIN",
  userPermissions: ["ManageGuild"],
  command: {
    enabled: true,
    usage: "<#channel> <messageId>",
    minArgsCount: 2,
  },
  // The slash surface lives at /roles reaction remove.
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
        description: "message id for which reaction roles was configured",
        type: ApplicationCommandOptionType.String,
        required: true,
      },
    ],
  },

  async messageRun(message, args, data) {
    const t = guildTranslator(data?.settings, message.guild);
    const targetChannel = message.guild.findMatchingChannels(args[0]);
    if (targetChannel.length === 0) return message.safeReply(t("reactionRoles.channelNotFound", { name: args[0] }));

    const result = await removeRR(message.guild, targetChannel[0], args[1]);
    await message.safeReply(t(result.key, result.vars));
  },

  async interactionRun(interaction, data) {
    const t = guildTranslator(data?.settings, interaction.guild);
    const result = await removeRR(
      interaction.guild,
      interaction.options.getChannel("channel"),
      interaction.options.getString("message_id")
    );
    await interaction.safeFollowUp(t(result.key, result.vars));
  },
};

/**
 * @returns {Promise<{ok: boolean, key: string, vars: object}>} the outcome as
 *   something the caller translates, so the panel and the command agree.
 */
async function removeRR(guild, channel, messageId) {
  const refuse = (key, vars = {}) => ({ ok: false, key, vars });

  if (!channel.permissionsFor(guild.members.me).has(channelPerms)) {
    return refuse("reactionRoles.needPermissions", {
      channel: channel.toString(),
      permissions: parsePermissions(channelPerms),
    });
  }

  let targetMessage;
  try {
    targetMessage = await channel.messages.fetch({ message: messageId });
  } catch (ex) {
    return refuse("reactionRoles.messageNotFound");
  }

  try {
    await removeReactionRole(guild.id, channel.id, targetMessage.id);
    await targetMessage.reactions?.removeAll();
  } catch (ex) {
    return refuse("reactionRoles.saveFailed");
  }

  return { ok: true, key: "reactionRoles.removed", vars: {} };
}

module.exports.removeRR = removeRR;
