const { addReactionRole, getReactionRoles } = require("@schemas/ReactionRoles");
const { parseEmoji, ApplicationCommandOptionType, ChannelType } = require("discord.js");
const { parsePermissions } = require("@helpers/Utils");
const { guildTranslator } = require("@src/i18n");

const channelPerms = ["EmbedLinks", "ReadMessageHistory", "AddReactions", "UseExternalEmojis", "ManageMessages"];

/**
 * @type {import("@structures/Command")}
 */
module.exports = {
  name: "addrr",
  description: "setup reaction role for the specified message",
  category: "ADMIN",
  userPermissions: ["ManageGuild"],
  command: {
    enabled: true,
    usage: "<#channel> <messageId> <emote> <role>",
    minArgsCount: 4,
  },
  // The slash surface lives at /roles reaction add - Discord caps an app at 100 slash commands.
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
        description: "message id to which reaction roles must be configured",
        type: ApplicationCommandOptionType.String,
        required: true,
      },
      {
        name: "emoji",
        description: "emoji to use",
        type: ApplicationCommandOptionType.String,
        required: true,
      },
      {
        name: "role",
        description: "role to be given for the selected emoji",
        type: ApplicationCommandOptionType.Role,
        required: true,
      },
    ],
  },

  async messageRun(message, args, data) {
    const t = guildTranslator(data?.settings, message.guild);
    const targetChannel = message.guild.findMatchingChannels(args[0]);
    if (targetChannel.length === 0) return message.safeReply(t("reactionRoles.channelNotFound", { name: args[0] }));

    const targetMessage = args[1];

    const role = message.guild.findMatchingRoles(args[3])[0];
    if (!role) return message.safeReply(t("reactionRoles.roleNotMatched", { name: args[3] }));

    const result = await addRR(message.guild, targetChannel[0], targetMessage, args[2], role);
    await message.safeReply(t(result.key, result.vars));
  },

  async interactionRun(interaction, data) {
    const t = guildTranslator(data?.settings, interaction.guild);
    const result = await addRR(
      interaction.guild,
      interaction.options.getChannel("channel"),
      interaction.options.getString("message_id"),
      interaction.options.getString("emoji"),
      interaction.options.getRole("role")
    );
    await interaction.safeFollowUp(t(result.key, result.vars));
  },
};

/**
 * @returns {Promise<{ok: boolean, key: string, vars: object}>} the outcome as
 *   something the caller translates, so the panel and the command agree.
 */
async function addRR(guild, channel, messageId, reaction, role) {
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

  if (role.managed) return refuse("reactionRoles.roleManaged", { role: role.toString() });
  if (guild.roles.everyone.id === role.id) return refuse("reactionRoles.roleEveryone");
  if (guild.members.me.roles.highest.position < role.position) {
    return refuse("reactionRoles.roleTooHigh", { role: role.toString() });
  }

  const custom = parseEmoji(reaction);
  if (custom.id && !guild.emojis.cache.has(custom.id)) {
    return refuse("reactionRoles.foreignEmoji", { emoji: reaction });
  }
  const emoji = custom.id ? custom.id : custom.name;

  try {
    await targetMessage.react(emoji);
  } catch (ex) {
    return refuse("reactionRoles.reactionFailed", { emoji: reaction });
  }

  const previousRoles = getReactionRoles(guild.id, channel.id, targetMessage.id);
  const replaced = previousRoles.some((rr) => rr.emote === emoji);

  await addReactionRole(guild.id, channel.id, targetMessage.id, emoji, role.id);
  return { ok: true, key: replaced ? "reactionRoles.replaced" : "reactionRoles.added", vars: { emoji: reaction } };
}

module.exports.addRR = addRR;
