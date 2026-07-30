const { ApplicationCommandOptionType, ChannelType, EmbedBuilder } = require("discord.js");
const { EMBED_COLORS } = require("@root/config");
const { deleteSticky, getSticky, listStickies, saveSticky } = require("@schemas/StickyMessage");
const { stickyHandler } = require("@src/handlers");

/**
 * @type {import("@structures/Command")}
 */
module.exports = {
  name: "sticky",
  description: "keep a message pinned to the bottom of a channel",
  category: "ADMIN",
  userPermissions: ["ManageGuild"],
  botPermissions: ["EmbedLinks", "ManageMessages"],
  command: {
    enabled: true,
    usage: "<set|remove|list|status> [#channel] [message]",
    minArgsCount: 1,
    subcommands: [
      { trigger: "set <#channel> <message>", description: "set the sticky message of a channel" },
      { trigger: "remove <#channel>", description: "remove the sticky message of a channel" },
      { trigger: "list", description: "list the sticky messages of this server" },
    ],
  },
  slashCommand: {
    enabled: true,
    ephemeral: true,
    options: [
      {
        name: "set",
        description: "set or replace the sticky message of a channel",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "channel",
            description: "channel the message sticks to",
            type: ApplicationCommandOptionType.Channel,
            channelTypes: [ChannelType.GuildText, ChannelType.GuildAnnouncement],
            required: true,
          },
          {
            name: "message",
            description: "text to keep at the bottom (use \\n for a line break)",
            type: ApplicationCommandOptionType.String,
            required: true,
          },
          {
            name: "title",
            description: "embed title",
            type: ApplicationCommandOptionType.String,
            required: false,
          },
          {
            name: "plain",
            description: "post as plain text instead of an embed",
            type: ApplicationCommandOptionType.Boolean,
            required: false,
          },
          {
            name: "min_messages",
            description: "messages to wait for before moving it down (default 1)",
            type: ApplicationCommandOptionType.Integer,
            required: false,
            minValue: 1,
            maxValue: 50,
          },
          {
            name: "cooldown",
            description: "seconds to wait between reposts (default 5)",
            type: ApplicationCommandOptionType.Integer,
            required: false,
            minValue: 0,
            maxValue: 3600,
          },
        ],
      },
      {
        name: "remove",
        description: "remove the sticky message of a channel",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "channel",
            description: "channel to clear",
            type: ApplicationCommandOptionType.Channel,
            required: true,
          },
        ],
      },
      {
        name: "list",
        description: "list the sticky messages of this server",
        type: ApplicationCommandOptionType.Subcommand,
      },
    ],
  },

  async messageRun(message, args, data) {
    const sub = args[0].toLowerCase();

    if (sub === "set") {
      const channel = message.guild.findMatchingChannels(args[1])[0];
      if (!channel) return message.safeReply("Provide a valid text channel");
      const content = args.slice(2).join(" ");
      if (!content) return message.safeReply("Provide the message to stick");
      return message.safeReply(
        await setSticky(message.guild, channel, content, { authorId: message.author.id, settings: data.settings })
      );
    }

    if (sub === "remove") {
      const channel = message.guild.findMatchingChannels(args[1])[0];
      if (!channel) return message.safeReply("Provide a valid text channel");
      return message.safeReply(await removeSticky(message.guild, channel));
    }

    if (sub === "list") return message.safeReply(await listAll(message.guild));

    return message.safeReply("Invalid subcommand");
  },

  async interactionRun(interaction, data) {
    const sub = interaction.options.getSubcommand();

    if (sub === "set") {
      return interaction.followUp(
        await setSticky(
          interaction.guild,
          interaction.options.getChannel("channel"),
          interaction.options.getString("message"),
          {
            authorId: interaction.user.id,
            title: interaction.options.getString("title"),
            plain: interaction.options.getBoolean("plain"),
            minMessages: interaction.options.getInteger("min_messages"),
            cooldown: interaction.options.getInteger("cooldown"),
          }
        )
      );
    }

    if (sub === "remove") {
      return interaction.followUp(await removeSticky(interaction.guild, interaction.options.getChannel("channel")));
    }

    if (sub === "list") return interaction.followUp(await listAll(interaction.guild));

    return interaction.followUp("Invalid subcommand");
  },
};

async function setSticky(guild, channel, content, options = {}) {
  const settings = options.settings || null;
  if (!channel.isTextBased()) return "Sticky messages only work in text channels.";

  const permissions = channel.permissionsFor(guild.members.me);
  if (!permissions?.has(["ViewChannel", "SendMessages", "ManageMessages", "ReadMessageHistory"])) {
    return `I need to view, send messages, read history and manage messages in ${channel}.`;
  }

  const text = content.replace(/\\n/g, "\n").slice(0, 2000);

  const existing = await getSticky(guild.id, channel.id);
  const sticky = await saveSticky({
    guild_id: guild.id,
    channel_id: channel.id,
    content: text,
    embed: options.plain === true ? false : (existing?.embed ?? true),
    title: options.title ?? existing?.title ?? null,
    min_messages: options.minMessages ?? existing?.min_messages ?? 1,
    cooldown_seconds: options.cooldown ?? existing?.cooldown_seconds ?? 5,
    enabled: true,
    created_by: options.authorId || existing?.created_by || null,
    last_message_id: existing?.last_message_id || null,
  });

  try {
    await stickyHandler.postNow(channel, sticky, settings);
  } catch (ex) {
    guild.client.logger?.error("sticky: failed to post", ex);
    return `Saved, but I could not post in ${channel}. Check my permissions.`;
  }

  return `Sticky message set for ${channel}. It moves back down after ${sticky.min_messages} message(s) and ${sticky.cooldown_seconds}s.`;
}

async function removeSticky(guild, channel) {
  const existing = await getSticky(guild.id, channel.id);
  if (!existing) return `${channel} has no sticky message.`;

  if (existing.last_message_id) {
    const target = guild.channels.cache.get(channel.id);
    await target?.messages
      ?.fetch(existing.last_message_id)
      .then((msg) => msg.delete())
      .catch(() => {});
  }

  await deleteSticky(guild.id, channel.id);
  stickyHandler.forget(channel.id);
  return `Sticky message removed from ${channel}.`;
}

async function listAll(guild) {
  const stickies = await listStickies(guild.id);
  if (stickies.length === 0) return "This server has no sticky messages.";

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLORS.BOT_EMBED)
    .setAuthor({ name: `Sticky messages · ${guild.name}` })
    .setDescription(
      stickies
        .map(
          (sticky) =>
            `<#${sticky.channel_id}> · ${sticky.enabled ? "active" : "paused"}\n` +
            `-# every ${sticky.min_messages} message(s), ${sticky.cooldown_seconds}s cooldown\n` +
            `> ${sticky.content.replace(/\n/g, " ").slice(0, 120)}`
        )
        .join("\n\n")
        .slice(0, 4000)
    );

  return { embeds: [embed] };
}
