const { ApplicationCommandOptionType, ChannelType, EmbedBuilder } = require("discord.js");
const { EMBED_COLORS } = require("@root/config");
const { getBirthday, isValidDate, removeBirthday, setBirthday, upcomingBirthdays } = require("@schemas/Birthday");
const { cancelAnnouncements, scheduleNextAnnouncement } = require("@src/services/birthdays/Birthdays");

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * @type {import("@structures/Command")}
 */
module.exports = {
  name: "birthday",
  description: "birthday announcements for this server",
  category: "UTILITY",
  botPermissions: ["EmbedLinks"],
  command: {
    enabled: true,
    aliases: ["bday"],
    usage: "<set|remove|show|list> ...",
    minArgsCount: 1,
    subcommands: [
      { trigger: "set <day> <month> [year]", description: "save your birthday" },
      { trigger: "remove", description: "delete your birthday" },
      { trigger: "show [@member]", description: "show a saved birthday" },
      { trigger: "list", description: "show the upcoming birthdays" },
    ],
  },
  slashCommand: {
    enabled: true,
    options: [
      {
        name: "set",
        description: "save your birthday",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "day",
            description: "day of the month",
            type: ApplicationCommandOptionType.Integer,
            required: true,
            minValue: 1,
            maxValue: 31,
          },
          {
            name: "month",
            description: "month",
            type: ApplicationCommandOptionType.Integer,
            required: true,
            choices: MONTHS.map((name, index) => ({ name, value: index + 1 })),
          },
          {
            name: "year",
            description: "year, if you want your age shown",
            type: ApplicationCommandOptionType.Integer,
            required: false,
            minValue: 1900,
            maxValue: 2100,
          },
        ],
      },
      {
        name: "remove",
        description: "delete your birthday",
        type: ApplicationCommandOptionType.Subcommand,
      },
      {
        name: "show",
        description: "show a saved birthday",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "user",
            description: "member to look up (defaults to you)",
            type: ApplicationCommandOptionType.User,
            required: false,
          },
        ],
      },
      {
        name: "list",
        description: "show the upcoming birthdays of this server",
        type: ApplicationCommandOptionType.Subcommand,
      },
      {
        name: "config",
        description: "configure birthday announcements (Manage Server)",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "status",
            description: "turn announcements on or off",
            type: ApplicationCommandOptionType.String,
            required: true,
            choices: [
              { name: "on", value: "ON" },
              { name: "off", value: "OFF" },
            ],
          },
          {
            name: "channel",
            description: "channel that receives the announcement",
            type: ApplicationCommandOptionType.Channel,
            channelTypes: [ChannelType.GuildText, ChannelType.GuildAnnouncement],
            required: false,
          },
          {
            name: "message",
            description: "message template: {member} {name} {age} {server}",
            type: ApplicationCommandOptionType.String,
            required: false,
          },
          {
            name: "role",
            description: "role given for the day",
            type: ApplicationCommandOptionType.Role,
            required: false,
          },
          {
            name: "hour",
            description: "local hour of the announcement (0-23)",
            type: ApplicationCommandOptionType.Integer,
            required: false,
            minValue: 0,
            maxValue: 23,
          },
          {
            name: "utc_offset",
            description: "server offset from UTC, e.g. 3 for UTC+3",
            type: ApplicationCommandOptionType.Integer,
            required: false,
            minValue: -12,
            maxValue: 14,
          },
        ],
      },
    ],
  },

  async messageRun(message, args, data) {
    const sub = args[0].toLowerCase();

    if (sub === "set") {
      const day = Number.parseInt(args[1], 10);
      const month = Number.parseInt(args[2], 10);
      const year = args[3] ? Number.parseInt(args[3], 10) : null;
      return message.safeReply(await save(message.guildId, message.author.id, day, month, year));
    }

    if (sub === "remove") {
      await removeBirthday(message.guildId, message.author.id);
      return message.safeReply("Your birthday was deleted.");
    }

    if (sub === "show") {
      const target = (await message.guild.resolveMember(args[1])) || message.member;
      return message.safeReply(await show(message.guildId, target.user));
    }

    if (sub === "list") return message.safeReply(await list(message.guild));

    if (sub === "config") {
      if (!message.member.permissions.has("ManageGuild")) {
        return message.safeReply("You need the `Manage Server` permission for this subcommand");
      }
      if (!["on", "off"].includes(args[1]?.toLowerCase())) return message.safeReply("Value must be `on` or `off`");
      return message.safeReply(
        await configure(message.guild, data.settings, { enabled: args[1].toLowerCase() === "on" })
      );
    }

    return message.safeReply("Invalid subcommand");
  },

  async interactionRun(interaction, data) {
    const sub = interaction.options.getSubcommand();

    if (sub === "set") {
      return interaction.followUp(
        await save(
          interaction.guildId,
          interaction.user.id,
          interaction.options.getInteger("day"),
          interaction.options.getInteger("month"),
          interaction.options.getInteger("year")
        )
      );
    }

    if (sub === "remove") {
      await removeBirthday(interaction.guildId, interaction.user.id);
      return interaction.followUp("Your birthday was deleted.");
    }

    if (sub === "show") {
      return interaction.followUp(
        await show(interaction.guildId, interaction.options.getUser("user") || interaction.user)
      );
    }

    if (sub === "list") return interaction.followUp(await list(interaction.guild));

    if (sub === "config") {
      if (!interaction.member.permissions.has("ManageGuild")) {
        return interaction.followUp("You need the `Manage Server` permission for this subcommand");
      }

      return interaction.followUp(
        await configure(interaction.guild, data.settings, {
          enabled: interaction.options.getString("status") === "ON",
          channel: interaction.options.getChannel("channel"),
          message: interaction.options.getString("message"),
          role: interaction.options.getRole("role"),
          hour: interaction.options.getInteger("hour"),
          utcOffset: interaction.options.getInteger("utc_offset"),
        })
      );
    }

    return interaction.followUp("Invalid subcommand");
  },
};

async function save(guildId, userId, day, month, year) {
  if (!isValidDate(day, month)) return "That is not a valid date.";
  if (year !== null && year !== undefined) {
    const age = new Date().getUTCFullYear() - year;
    if (age < 13 || age > 120) return "Discord requires members to be at least 13, and that year looks wrong.";
  }

  await setBirthday({ guildId, userId, day, month, year: year ?? null });
  return `Saved: **${day} ${MONTHS[month - 1]}**${year ? ` ${year}` : ""}.`;
}

async function show(guildId, user) {
  const entry = await getBirthday(guildId, user.id);
  if (!entry) return `${user.username} has no birthday saved.`;

  return `**${user.username}**: ${entry.day} ${MONTHS[entry.month - 1]}${entry.year ? ` ${entry.year}` : ""}`;
}

async function list(guild) {
  const entries = await upcomingBirthdays({ guildId: guild.id, limit: 15 });
  if (entries.length === 0) return "Nobody has saved a birthday yet.";

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLORS.BOT_EMBED)
    .setAuthor({ name: `Upcoming birthdays · ${guild.name}` })
    .setDescription(
      entries.map((entry) => `**${entry.day} ${MONTHS[entry.month - 1]}** · <@${entry.user_id}>`).join("\n")
    );

  return { embeds: [embed] };
}

async function configure(guild, settings, changes) {
  settings.birthdays.enabled = changes.enabled;

  if (changes.channel) {
    if (!changes.channel.permissionsFor(guild.members.me)?.has(["ViewChannel", "SendMessages", "EmbedLinks"])) {
      return `I need to view, send messages and embed links in ${changes.channel}.`;
    }
    settings.birthdays.channel_id = changes.channel.id;
  }

  if (changes.message) settings.birthdays.message = changes.message.slice(0, 1000);

  if (changes.role) {
    if (changes.role.managed) return `${changes.role} is managed by an integration.`;
    if (guild.members.me.roles.highest.position <= changes.role.position) {
      return `${changes.role} is above my highest role, so I cannot assign it.`;
    }
    settings.birthdays.role_id = changes.role.id;
  }

  if (changes.hour !== null && changes.hour !== undefined) settings.birthdays.hour = changes.hour;
  if (changes.utcOffset !== null && changes.utcOffset !== undefined) settings.birthdays.utc_offset = changes.utcOffset;

  if (changes.enabled && !settings.birthdays.channel_id) {
    return "Set a channel first: `/birthday config status:on channel:#general`.";
  }

  await settings.save();

  if (changes.enabled) {
    const runAt = await scheduleNextAnnouncement({
      guildId: guild.id,
      hour: settings.birthdays.hour,
      utcOffset: settings.birthdays.utc_offset,
    });

    return (
      `Birthday announcements enabled in <#${settings.birthdays.channel_id}> at ` +
      `${settings.birthdays.hour}:00 UTC${formatOffset(settings.birthdays.utc_offset)}. ` +
      `Next check: <t:${Math.floor(new Date(runAt.run_at).getTime() / 1000)}:R>.`
    );
  }

  await cancelAnnouncements(guild.id);
  return "Birthday announcements disabled.";
}

function formatOffset(offset) {
  if (!offset) return "";
  return offset > 0 ? `+${offset}` : String(offset);
}
