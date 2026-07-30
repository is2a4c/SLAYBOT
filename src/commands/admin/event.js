const { ApplicationCommandOptionType, ChannelType, EmbedBuilder, time } = require("discord.js");
const ems = require("enhanced-ms");
const { EMBED_COLORS } = require("@root/config");
const {
  EventError,
  buildEventEmbed,
  cancelReminder,
  createEvent,
  resolveWindow,
  scheduleReminder,
} = require("@src/services/events/ScheduledEvents");

/**
 * @type {import("@structures/Command")}
 */
module.exports = {
  name: "event",
  description: "create and announce scheduled server events",
  category: "ADMIN",
  userPermissions: ["ManageEvents"],
  botPermissions: ["ManageEvents", "EmbedLinks"],
  command: {
    enabled: true,
    aliases: ["events"],
    usage: "<list|cancel> ...",
    minArgsCount: 1,
    subcommands: [
      { trigger: "list", description: "list the upcoming events" },
      { trigger: "cancel <eventId>", description: "cancel an event" },
    ],
  },
  slashCommand: {
    enabled: true,
    ephemeral: true,
    options: [
      {
        name: "create",
        description: "create a scheduled event",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "name",
            description: "event name",
            type: ApplicationCommandOptionType.String,
            required: true,
          },
          {
            name: "starts_in",
            description: "when it starts, e.g. 2h or 3d",
            type: ApplicationCommandOptionType.String,
            required: true,
          },
          {
            name: "voice_channel",
            description: "voice channel the event happens in",
            type: ApplicationCommandOptionType.Channel,
            channelTypes: [ChannelType.GuildVoice, ChannelType.GuildStageVoice],
            required: false,
          },
          {
            name: "location",
            description: "external location, used instead of a voice channel",
            type: ApplicationCommandOptionType.String,
            required: false,
          },
          {
            name: "duration",
            description: "how long it lasts, e.g. 90m (required for a location)",
            type: ApplicationCommandOptionType.String,
            required: false,
          },
          {
            name: "description",
            description: "what the event is about",
            type: ApplicationCommandOptionType.String,
            required: false,
          },
          {
            name: "announce_in",
            description: "channel that gets the announcement and the reminder",
            type: ApplicationCommandOptionType.Channel,
            channelTypes: [ChannelType.GuildText, ChannelType.GuildAnnouncement],
            required: false,
          },
          {
            name: "remind_before",
            description: "reminder lead time, e.g. 30m (needs announce_in)",
            type: ApplicationCommandOptionType.String,
            required: false,
          },
          {
            name: "mention",
            description: "role pinged by the announcement and the reminder",
            type: ApplicationCommandOptionType.Role,
            required: false,
          },
        ],
      },
      {
        name: "list",
        description: "list the upcoming events",
        type: ApplicationCommandOptionType.Subcommand,
      },
      {
        name: "cancel",
        description: "cancel an event",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "event_id",
            description: "id shown by /event list",
            type: ApplicationCommandOptionType.String,
            required: true,
          },
        ],
      },
    ],
  },

  async messageRun(message, args) {
    const sub = args[0].toLowerCase();

    if (sub === "list") return message.safeReply(await list(message.guild));
    if (sub === "cancel") return message.safeReply(await cancel(message.guild, args[1]));

    return message.safeReply("Use `/event create` to create an event.");
  },

  async interactionRun(interaction) {
    const sub = interaction.options.getSubcommand();

    try {
      if (sub === "create") return interaction.followUp(await create(interaction));
      if (sub === "list") return interaction.followUp(await list(interaction.guild));
      if (sub === "cancel")
        return interaction.followUp(await cancel(interaction.guild, interaction.options.getString("event_id")));
    } catch (ex) {
      if (ex instanceof EventError) return interaction.followUp(ex.message);
      throw ex;
    }

    return interaction.followUp("Invalid subcommand");
  },
};

async function create(interaction) {
  const guild = interaction.guild;
  const durationInput = interaction.options.getString("duration");
  const remindInput = interaction.options.getString("remind_before");
  const announceIn = interaction.options.getChannel("announce_in");
  const mention = interaction.options.getRole("mention");

  const { startsAt, endsAt } = resolveWindow({
    startInMs: ems(interaction.options.getString("starts_in")),
    durationMs: durationInput ? ems(durationInput) : null,
  });

  const event = await createEvent({
    guild,
    name: interaction.options.getString("name"),
    description: interaction.options.getString("description"),
    startsAt,
    endsAt,
    channel: interaction.options.getChannel("voice_channel"),
    location: interaction.options.getString("location"),
  });

  const lines = [`Created **${event.name}**, starting ${time(startsAt, "R")}.`, event.url];

  if (announceIn) {
    if (!announceIn.permissionsFor(guild.members.me)?.has(["ViewChannel", "SendMessages", "EmbedLinks"])) {
      lines.push(`I cannot post in ${announceIn}, so no announcement was sent.`);
    } else {
      await announceIn
        .send({ content: mention ? `${mention}` : undefined, embeds: [buildEventEmbed(event)] })
        .catch(() => {});
      lines.push(`Announced in ${announceIn}.`);

      if (remindInput) {
        const leadMs = ems(remindInput);
        if (!Number.isFinite(leadMs)) throw new EventError("Provide the reminder lead time as `30m` or `2h`.");

        const remindAt = new Date(startsAt.getTime() - leadMs);
        if (remindAt.getTime() <= Date.now()) {
          lines.push("The reminder lead time is already in the past, so no reminder was scheduled.");
        } else {
          await scheduleReminder({
            guildId: guild.id,
            eventId: event.id,
            channelId: announceIn.id,
            remindAt,
            mention: mention ? `<@&${mention.id}>` : null,
          });
          lines.push(`Reminder set for ${time(remindAt, "R")}.`);
        }
      }
    }
  }

  return lines.join("\n");
}

async function list(guild) {
  const events = await guild.scheduledEvents.fetch().catch(() => null);
  if (!events || events.size === 0) return "No upcoming events.";

  const sorted = [...events.values()].sort((a, b) => a.scheduledStartTimestamp - b.scheduledStartTimestamp);

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLORS.BOT_EMBED)
    .setAuthor({ name: `Upcoming events · ${guild.name}` })
    .setDescription(
      sorted
        .map(
          (event) =>
            `**${event.name}** · ${time(event.scheduledStartAt, "R")}\n` +
            `-# \`${event.id}\`${event.channelId ? ` · <#${event.channelId}>` : ""}` +
            `${typeof event.userCount === "number" ? ` · ${event.userCount} interested` : ""}`
        )
        .join("\n\n")
        .slice(0, 4000)
    );

  return { embeds: [embed] };
}

async function cancel(guild, eventId) {
  if (!eventId) return "Provide the event id from `/event list`.";

  const event = await guild.scheduledEvents.fetch(eventId).catch(() => null);
  if (!event) return "No event found with that id.";

  await event.delete().catch(() => null);
  await cancelReminder(guild.id, eventId);

  return `Cancelled **${event.name}** and removed its reminder.`;
}
