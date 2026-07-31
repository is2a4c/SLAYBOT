const { getReactionRoles, replaceReactionRoles } = require("@schemas/ReactionRoles");
const { normalizeReactionEmoji, parseReactionRoleMappings } = require("@helpers/ReactionRoleMappings");
const { parsePermissions } = require("@helpers/Utils");
const { ApplicationCommandOptionType, ChannelType } = require("discord.js");

const channelPerms = ["EmbedLinks", "ReadMessageHistory", "AddReactions", "UseExternalEmojis", "ManageMessages"];

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

  async messageRun(message, args) {
    const targetChannels = message.guild.findMatchingChannels(args[0]);
    if (targetChannels.length === 0) return message.safeReply(`No channels found matching ${args[0]}`);

    const response = await setReactionRoles(message.guild, targetChannels[0], args[1], args.slice(2).join(" "));
    await message.safeReply(response);
  },

  async interactionRun(interaction) {
    const response = await setReactionRoles(
      interaction.guild,
      interaction.options.getChannel("channel"),
      interaction.options.getString("message_id"),
      interaction.options.getString("pairs")
    );
    await interaction.safeFollowUp(response);
  },
};

async function setReactionRoles(guild, channel, messageId, input) {
  if (!channel.permissionsFor(guild.members.me).has(channelPerms)) {
    return `You need the following permissions in ${channel.toString()}\n${parsePermissions(channelPerms)}`;
  }

  let targetMessage;
  try {
    targetMessage = await channel.messages.fetch({ message: messageId });
  } catch (ex) {
    return "Could not fetch message. Did you provide a valid messageId?";
  }

  let requested;
  try {
    requested = parseReactionRoleMappings(input);
  } catch (ex) {
    return ex.message;
  }

  const roles = [];
  const seenEmojis = new Set();
  for (const pair of requested) {
    const role = guild.roles.cache.get(pair.roleId);
    if (!role) return `Role <@&${pair.roleId}> was not found on this server.`;
    if (role.managed) return `I cannot assign the managed role ${role.toString()}.`;
    if (guild.roles.everyone.id === role.id) return "You cannot assign the everyone role.";
    if (guild.members.me.roles.highest.position <= role.position) {
      return `I cannot assign ${role.toString()}. Move my highest role above it and try again.`;
    }

    let emote;
    try {
      emote = normalizeReactionEmoji(pair.reaction, guild);
    } catch (ex) {
      return ex.message;
    }
    if (seenEmojis.has(emote)) return `Emoji ${pair.reaction} is listed more than once.`;

    seenEmojis.add(emote);
    roles.push({ emote, role_id: role.id });
  }

  for (const role of roles) {
    try {
      await targetMessage.react(role.emote);
    } catch (ex) {
      return `Failed to add reaction ${role.emote}. No configuration was saved.`;
    }
  }

  const previousRoles = getReactionRoles(guild.id, channel.id, targetMessage.id);
  try {
    await replaceReactionRoles(guild.id, channel.id, targetMessage.id, roles);
  } catch (ex) {
    return "Failed to save reaction roles. Try again later.";
  }

  const obsoleteEmojis = previousRoles.map((role) => role.emote).filter((emote) => !seenEmojis.has(emote));
  await Promise.all(
    obsoleteEmojis.map((emote) =>
      targetMessage.reactions
        .resolve(emote)
        ?.users.remove(guild.members.me.id)
        .catch(() => {})
    )
  );

  return `Done! Saved ${roles.length} reaction role${roles.length === 1 ? "" : "s"} for this message.`;
}

module.exports.setReactionRoles = setReactionRoles;
