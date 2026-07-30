const { ApplicationCommandOptionType, ChannelType, EmbedBuilder } = require("discord.js");
const { EMBED_COLORS } = require("@root/config");
const { MAX_FEEDS_PER_GUILD, countFeeds, createFeed, deleteFeed, findFeed, listFeeds } = require("@schemas/Feed");
const { FeedError, fetchLatest, normalizeTarget } = require("@src/services/feeds/providers");
const { decideAnnouncement } = require("@src/services/feeds/FeedWatcher");

const TYPE_CHOICES = [
  { name: "Twitch stream", value: "TWITCH" },
  { name: "YouTube uploads", value: "YOUTUBE" },
  { name: "RSS / Atom feed", value: "RSS" },
  { name: "GitHub releases", value: "GITHUB" },
];

const TARGET_HINT = {
  TWITCH: "channel name, e.g. `ninja`",
  YOUTUBE: "channel id starting with `UC`",
  RSS: "feed url",
  GITHUB: "`owner/repo`",
};

/**
 * @type {import("@structures/Command")}
 */
module.exports = {
  name: "feeds",
  description: "announce Twitch streams, YouTube uploads, RSS items and GitHub releases",
  category: "ADMIN",
  userPermissions: ["ManageGuild"],
  botPermissions: ["EmbedLinks"],
  command: {
    enabled: true,
    aliases: ["feed", "autofeed"],
    usage: "<add|remove|list|test> ...",
    minArgsCount: 1,
    subcommands: [
      { trigger: "add <twitch|youtube|rss|github> <target> <#channel>", description: "watch a source" },
      { trigger: "remove <twitch|youtube|rss|github> <target>", description: "stop watching a source" },
      { trigger: "list", description: "list the configured feeds" },
      { trigger: "test <twitch|youtube|rss|github> <target>", description: "fetch a source without saving it" },
    ],
  },
  slashCommand: {
    enabled: true,
    ephemeral: true,
    options: [
      {
        name: "add",
        description: "watch a source and announce new items",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "type",
            description: "what kind of source",
            type: ApplicationCommandOptionType.String,
            required: true,
            choices: TYPE_CHOICES,
          },
          {
            name: "target",
            description: "channel name, channel id, repository or url",
            type: ApplicationCommandOptionType.String,
            required: true,
          },
          {
            name: "channel",
            description: "where the announcement is posted",
            type: ApplicationCommandOptionType.Channel,
            channelTypes: [ChannelType.GuildText, ChannelType.GuildAnnouncement],
            required: true,
          },
          {
            name: "mention",
            description: "role pinged with the announcement",
            type: ApplicationCommandOptionType.Role,
            required: false,
          },
          {
            name: "message",
            description: "custom announcement text",
            type: ApplicationCommandOptionType.String,
            required: false,
          },
        ],
      },
      {
        name: "remove",
        description: "stop watching a source",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "type",
            description: "what kind of source",
            type: ApplicationCommandOptionType.String,
            required: true,
            choices: TYPE_CHOICES,
          },
          {
            name: "target",
            description: "the target that was configured",
            type: ApplicationCommandOptionType.String,
            required: true,
          },
          {
            name: "channel",
            description: "only remove the feed of this channel",
            type: ApplicationCommandOptionType.Channel,
            required: false,
          },
        ],
      },
      {
        name: "list",
        description: "list the configured feeds",
        type: ApplicationCommandOptionType.Subcommand,
      },
      {
        name: "test",
        description: "fetch a source right now without saving it",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "type",
            description: "what kind of source",
            type: ApplicationCommandOptionType.String,
            required: true,
            choices: TYPE_CHOICES,
          },
          {
            name: "target",
            description: "channel name, channel id, repository or url",
            type: ApplicationCommandOptionType.String,
            required: true,
          },
        ],
      },
    ],
  },

  async messageRun(message, args) {
    const sub = args[0].toLowerCase();
    const type = (args[1] || "").toUpperCase();

    try {
      if (sub === "add") {
        const channel = message.guild.findMatchingChannels(args[3])[0];
        if (!channel) return message.safeReply("Provide a valid text channel");
        return message.safeReply(
          await add(message.guild, { type, target: args[2], channel, authorId: message.author.id })
        );
      }

      if (sub === "remove") {
        return message.safeReply(await remove(message.guild, { type, target: args[2] }));
      }

      if (sub === "list") return message.safeReply(await renderList(message.guild));

      if (sub === "test") return message.safeReply(await testSource(type, args[2]));
    } catch (ex) {
      if (ex instanceof FeedError) return message.safeReply(ex.message);
      throw ex;
    }

    return message.safeReply("Invalid subcommand");
  },

  async interactionRun(interaction) {
    const sub = interaction.options.getSubcommand();

    try {
      if (sub === "add") {
        return interaction.followUp(
          await add(interaction.guild, {
            type: interaction.options.getString("type"),
            target: interaction.options.getString("target"),
            channel: interaction.options.getChannel("channel"),
            mention: interaction.options.getRole("mention"),
            message: interaction.options.getString("message"),
            authorId: interaction.user.id,
          })
        );
      }

      if (sub === "remove") {
        return interaction.followUp(
          await remove(interaction.guild, {
            type: interaction.options.getString("type"),
            target: interaction.options.getString("target"),
            channel: interaction.options.getChannel("channel"),
          })
        );
      }

      if (sub === "list") return interaction.followUp(await renderList(interaction.guild));

      if (sub === "test") {
        return interaction.followUp(
          await testSource(interaction.options.getString("type"), interaction.options.getString("target"))
        );
      }
    } catch (ex) {
      if (ex instanceof FeedError) return interaction.followUp(ex.message);
      throw ex;
    }

    return interaction.followUp("Invalid subcommand");
  },
};

async function add(guild, { type, target, channel, mention, message, authorId }) {
  const normalized = normalizeTarget(type, target);

  if (!channel.isTextBased()) return "Announcements need a text channel.";
  if (!channel.permissionsFor(guild.members.me)?.has(["ViewChannel", "SendMessages", "EmbedLinks"])) {
    return `I need to view, send messages and embed links in ${channel}.`;
  }

  if ((await countFeeds(guild.id)) >= MAX_FEEDS_PER_GUILD) {
    return `A server can watch at most ${MAX_FEEDS_PER_GUILD} sources.`;
  }

  if (await findFeed({ guildId: guild.id, type, target: normalized, channelId: channel.id })) {
    return `\`${normalized}\` is already watched in ${channel}.`;
  }

  // Fail fast on a target that does not exist, and adopt the current item so the
  // channel does not get a backlog announcement right after setup.
  const latest = await fetchLatest(type, normalized);
  const { store } = decideAnnouncement({ lastItemId: null, item: latest, firstRun: true });

  await createFeed({
    guild_id: guild.id,
    type,
    target: normalized,
    channel_id: channel.id,
    mention: mention ? `<@&${mention.id}>` : null,
    message: message || null,
    last_item_id: store,
    last_checked_at: new Date(),
    created_by: authorId,
  });

  return (
    `Watching **${normalized}** (${type.toLowerCase()}) in ${channel}. ` +
    `${latest ? "The current item was skipped; the next one is announced." : "Nothing is published yet; the next item is announced."}`
  );
}

async function remove(guild, { type, target, channel }) {
  const normalized = normalizeTarget(type, target);
  const result = await deleteFeed({
    guildId: guild.id,
    type,
    target: normalized,
    channelId: channel?.id,
  });

  if (!result.deletedCount) return `\`${normalized}\` is not being watched${channel ? ` in ${channel}` : ""}.`;
  return `Stopped watching **${normalized}**.`;
}

async function renderList(guild) {
  const feeds = await listFeeds(guild.id);
  if (feeds.length === 0) {
    return "No feeds configured. Add one with `/feeds add`.";
  }

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLORS.BOT_EMBED)
    .setAuthor({ name: `Feeds · ${guild.name}` })
    .setDescription(
      feeds
        .map((feed) => {
          const state = feed.enabled ? "active" : "paused";
          const error = feed.last_error ? `\n-# last error: ${feed.last_error}` : "";
          return (
            `**${feed.type.toLowerCase()}** \`${feed.target}\` → <#${feed.channel_id}> · ${state}` +
            `${feed.mention ? ` · pings ${feed.mention}` : ""}${error}`
          );
        })
        .join("\n\n")
        .slice(0, 4000)
    )
    .setFooter({ text: `${feeds.length}/${MAX_FEEDS_PER_GUILD} feeds` });

  return { embeds: [embed] };
}

async function testSource(type, target) {
  const normalized = normalizeTarget(type, target);
  const latest = await fetchLatest(type, normalized);

  if (!latest) {
    return type === "TWITCH"
      ? `**${normalized}** is offline right now. The feed works.`
      : `**${normalized}** has no items yet. The feed works.`;
  }

  return (
    `**${normalized}** works. Latest item:\n` +
    `> ${latest.title}\n${latest.link || ""}\n` +
    `-# hint: target is stored as \`${normalized}\` (${TARGET_HINT[type]})`
  );
}
