const { ApplicationCommandOptionType, ChannelType, EmbedBuilder, parseEmoji } = require("discord.js");
const { parse: parseUnicodeEmoji } = require("twemoji-parser");
const { EMBED_COLORS } = require("@root/config");
const { topEntries, deleteGuildEntries } = require("@schemas/StarboardEntry");

const MAX_IGNORED_CHANNELS = 25;

/**
 * @type {import("@structures/Command")}
 */
module.exports = {
  name: "starboard",
  description: "highlight the messages your members star",
  category: "ADMIN",
  userPermissions: ["ManageGuild"],
  botPermissions: ["EmbedLinks"],
  command: {
    enabled: true,
    usage: "<channel|off|emoji|threshold|status|ignore|unignore|top> [value]",
    minArgsCount: 1,
    subcommands: [
      { trigger: "channel <#channel>", description: "post starred messages in this channel" },
      { trigger: "off", description: "disable the starboard" },
      { trigger: "emoji <emoji>", description: "set the emoji members react with" },
      { trigger: "threshold <number>", description: "how many reactions a message needs" },
      { trigger: "selfstar <on|off>", description: "count the author's own star" },
      { trigger: "ignore <#channel>", description: "never mirror messages from this channel" },
      { trigger: "unignore <#channel>", description: "stop ignoring a channel" },
      { trigger: "status", description: "show the starboard configuration" },
      { trigger: "top", description: "show the most starred messages" },
    ],
  },
  slashCommand: {
    enabled: true,
    ephemeral: true,
    options: [
      {
        name: "channel",
        description: "post starred messages in a channel and enable the starboard",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "channel",
            description: "channel that receives the starred messages",
            type: ApplicationCommandOptionType.Channel,
            channelTypes: [ChannelType.GuildText, ChannelType.GuildAnnouncement],
            required: true,
          },
        ],
      },
      {
        name: "off",
        description: "disable the starboard",
        type: ApplicationCommandOptionType.Subcommand,
      },
      {
        name: "config",
        description: "tune the starboard rules",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "emoji",
            description: "emoji members react with (default ⭐)",
            type: ApplicationCommandOptionType.String,
            required: false,
          },
          {
            name: "threshold",
            description: "how many reactions a message needs",
            type: ApplicationCommandOptionType.Integer,
            required: false,
            minValue: 1,
            maxValue: 100,
          },
          {
            name: "self_star",
            description: "count the author's own reaction",
            type: ApplicationCommandOptionType.Boolean,
            required: false,
          },
          {
            name: "allow_bots",
            description: "also mirror messages posted by bots",
            type: ApplicationCommandOptionType.Boolean,
            required: false,
          },
          {
            name: "remove_below",
            description: "remove the mirror when the count drops below the threshold",
            type: ApplicationCommandOptionType.Boolean,
            required: false,
          },
          {
            name: "color",
            description: "embed colour as a hex value, e.g. #FFCC00",
            type: ApplicationCommandOptionType.String,
            required: false,
          },
        ],
      },
      {
        name: "ignore",
        description: "never mirror messages from a channel",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "channel",
            description: "channel to ignore",
            type: ApplicationCommandOptionType.Channel,
            required: true,
          },
        ],
      },
      {
        name: "unignore",
        description: "stop ignoring a channel",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "channel",
            description: "channel to stop ignoring",
            type: ApplicationCommandOptionType.Channel,
            required: true,
          },
        ],
      },
      {
        name: "status",
        description: "show the starboard configuration",
        type: ApplicationCommandOptionType.Subcommand,
      },
      {
        name: "top",
        description: "show the most starred messages of this server",
        type: ApplicationCommandOptionType.Subcommand,
      },
      {
        name: "purge",
        description: "forget every starboard entry of this server",
        type: ApplicationCommandOptionType.Subcommand,
      },
    ],
  },

  async messageRun(message, args, data) {
    const sub = args[0].toLowerCase();
    const settings = data.settings;

    if (sub === "channel") {
      const channel = message.guild.findMatchingChannels(args[1])[0];
      if (!channel) return message.safeReply("Provide a valid text channel");
      return message.safeReply(await setChannel(message.guild, settings, channel));
    }

    if (sub === "off") return message.safeReply(await disable(settings));

    if (sub === "emoji") return message.safeReply(await configure(settings, { emoji: args[1] }));

    if (sub === "threshold") {
      const threshold = Number.parseInt(args[1], 10);
      return message.safeReply(await configure(settings, { threshold }));
    }

    if (sub === "selfstar") {
      if (!["on", "off"].includes(args[1]?.toLowerCase())) return message.safeReply("Value must be `on` or `off`");
      return message.safeReply(await configure(settings, { self_star: args[1].toLowerCase() === "on" }));
    }

    if (sub === "ignore" || sub === "unignore") {
      const channel = message.guild.findMatchingChannels(args[1])[0];
      if (!channel) return message.safeReply("Provide a valid channel");
      return message.safeReply(await toggleIgnored(settings, channel, sub === "ignore"));
    }

    if (sub === "status") return message.safeReply({ embeds: [statusEmbed(message.guild, settings)] });

    if (sub === "top") return message.safeReply(await topStarred(message.guild));

    return message.safeReply("Invalid subcommand");
  },

  async interactionRun(interaction, data) {
    const sub = interaction.options.getSubcommand();
    const settings = data.settings;

    if (sub === "channel") {
      return interaction.followUp(
        await setChannel(interaction.guild, settings, interaction.options.getChannel("channel"))
      );
    }

    if (sub === "off") return interaction.followUp(await disable(settings));

    if (sub === "config") {
      return interaction.followUp(
        await configure(settings, {
          emoji: interaction.options.getString("emoji"),
          threshold: interaction.options.getInteger("threshold"),
          self_star: interaction.options.getBoolean("self_star"),
          allow_bots: interaction.options.getBoolean("allow_bots"),
          remove_below: interaction.options.getBoolean("remove_below"),
          color: interaction.options.getString("color"),
        })
      );
    }

    if (sub === "ignore" || sub === "unignore") {
      return interaction.followUp(
        await toggleIgnored(settings, interaction.options.getChannel("channel"), sub === "ignore")
      );
    }

    if (sub === "status") return interaction.followUp({ embeds: [statusEmbed(interaction.guild, settings)] });

    if (sub === "top") return interaction.followUp(await topStarred(interaction.guild));

    if (sub === "purge") {
      const result = await deleteGuildEntries(interaction.guildId);
      return interaction.followUp(`Forgot ${result.deletedCount || 0} starboard entr(ies).`);
    }

    return interaction.followUp("Invalid subcommand");
  },
};

async function setChannel(guild, settings, channel) {
  if (!channel.isTextBased()) return "The starboard channel must be a text channel.";

  const permissions = channel.permissionsFor(guild.members.me);
  if (!permissions?.has(["ViewChannel", "SendMessages", "EmbedLinks"])) {
    return `I need to view, send messages and embed links in ${channel}.`;
  }

  settings.starboard.channel_id = channel.id;
  settings.starboard.enabled = true;
  await settings.save();

  return (
    `Starboard enabled in ${channel}. Messages with **${settings.starboard.threshold}** ` +
    `${settings.starboard.emoji} reactions are mirrored there.`
  );
}

async function disable(settings) {
  settings.starboard.enabled = false;
  await settings.save();
  return "Starboard disabled. The existing entries are kept.";
}

/**
 * @param {string} input
 */
function normalizeStarEmoji(input) {
  const custom = parseEmoji(input);
  if (custom?.id) return input;

  const parsed = parseUnicodeEmoji(input);
  if (parsed.length !== 1 || parsed[0].text !== input) return null;
  return input;
}

async function configure(settings, changes) {
  const applied = [];

  if (changes.emoji) {
    const emoji = normalizeStarEmoji(changes.emoji.trim());
    if (!emoji) return `${changes.emoji} is not a valid emoji.`;
    settings.starboard.emoji = emoji;
    applied.push(`emoji ${emoji}`);
  }

  if (changes.threshold !== null && changes.threshold !== undefined) {
    if (!Number.isInteger(changes.threshold) || changes.threshold < 1 || changes.threshold > 100) {
      return "The threshold must be a whole number between 1 and 100.";
    }
    settings.starboard.threshold = changes.threshold;
    applied.push(`threshold ${changes.threshold}`);
  }

  if (changes.color) {
    if (!/^#[0-9a-f]{6}$/i.test(changes.color)) return "The colour must be a hex value such as `#FFCC00`.";
    settings.starboard.color = changes.color;
    applied.push(`colour ${changes.color}`);
  }

  for (const key of ["self_star", "allow_bots", "remove_below"]) {
    if (changes[key] !== null && changes[key] !== undefined) {
      settings.starboard[key] = changes[key];
      applied.push(`${key.replace(/_/g, " ")} ${changes[key] ? "on" : "off"}`);
    }
  }

  if (applied.length === 0) return "Nothing to change. Provide at least one option.";

  await settings.save();
  return `Starboard updated: ${applied.join(", ")}.`;
}

async function toggleIgnored(settings, channel, ignore) {
  const ignored = settings.starboard.ignored_channels || [];

  if (ignore) {
    if (ignored.includes(channel.id)) return `${channel} is already ignored.`;
    if (ignored.length >= MAX_IGNORED_CHANNELS) return `At most ${MAX_IGNORED_CHANNELS} channels can be ignored.`;
    settings.starboard.ignored_channels = [...ignored, channel.id];
  } else {
    if (!ignored.includes(channel.id)) return `${channel} is not ignored.`;
    settings.starboard.ignored_channels = ignored.filter((id) => id !== channel.id);
  }

  await settings.save();
  return ignore ? `${channel} is now ignored by the starboard.` : `${channel} is no longer ignored.`;
}

function statusEmbed(guild, settings) {
  const config = settings.starboard || {};

  return new EmbedBuilder()
    .setColor(config.color || EMBED_COLORS.BOT_EMBED)
    .setAuthor({ name: `Starboard · ${guild.name}` })
    .setDescription(
      [
        `**Status:** ${config.enabled ? "enabled" : "disabled"}`,
        `**Channel:** ${config.channel_id ? `<#${config.channel_id}>` : "not set"}`,
        `**Emoji:** ${config.emoji || "⭐"}`,
        `**Threshold:** ${config.threshold || 3}`,
        `**Self star counts:** ${config.self_star === false ? "no" : "yes"}`,
        `**Bot messages:** ${config.allow_bots ? "mirrored" : "skipped"}`,
        `**Removes below threshold:** ${config.remove_below === false ? "no" : "yes"}`,
        `**Ignored channels:** ${
          config.ignored_channels?.length ? config.ignored_channels.map((id) => `<#${id}>`).join(", ") : "none"
        }`,
      ].join("\n")
    );
}

async function topStarred(guild) {
  const entries = await topEntries(guild.id, 10);
  if (entries.length === 0) return "No starred messages yet.";

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLORS.BOT_EMBED)
    .setAuthor({ name: `Most starred · ${guild.name}` })
    .setDescription(
      entries
        .map(
          (entry, index) =>
            `**${index + 1}.** ${entry.count} · ` +
            `[jump](https://discord.com/channels/${guild.id}/${entry.channel_id}/${entry.message_id})` +
            `${entry.author_id ? ` · <@${entry.author_id}>` : ""}`
        )
        .join("\n")
    );

  return { embeds: [embed] };
}
