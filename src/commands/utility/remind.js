const { ApplicationCommandOptionType, EmbedBuilder, time } = require("discord.js");
const ems = require("enhanced-ms");
const { EMBED_COLORS } = require("@root/config");
const {
  MAX_PER_USER,
  ReminderError,
  cancelReminder,
  createReminder,
  describeReminder,
  listReminders,
  reminderSummary,
} = require("@src/services/reminders/Reminders");

/**
 * @type {import("@structures/Command")}
 */
module.exports = {
  name: "remind",
  description: "ask the bot to remind you later",
  category: "UTILITY",
  cooldown: 3,
  command: {
    enabled: true,
    aliases: ["reminder", "remindme"],
    usage: "<duration> <text> | list | cancel <number>",
    minArgsCount: 1,
    subcommands: [
      { trigger: "<duration> <text>", description: "remind you in this channel after the given delay" },
      { trigger: "list", description: "list your pending reminders" },
      { trigger: "cancel <number>", description: "cancel a reminder from the list" },
    ],
  },
  slashCommand: {
    enabled: true,
    ephemeral: true,
    options: [
      {
        name: "me",
        description: "set a reminder",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "in",
            description: "delay such as 10m, 2h or 3d",
            type: ApplicationCommandOptionType.String,
            required: true,
          },
          {
            name: "about",
            description: "what to remind you about",
            type: ApplicationCommandOptionType.String,
            required: true,
          },
          {
            name: "dm",
            description: "send the reminder as a direct message",
            type: ApplicationCommandOptionType.Boolean,
            required: false,
          },
          {
            name: "every",
            description: "repeat the reminder with this interval, e.g. 1d",
            type: ApplicationCommandOptionType.String,
            required: false,
          },
        ],
      },
      {
        name: "list",
        description: "list your pending reminders",
        type: ApplicationCommandOptionType.Subcommand,
      },
      {
        name: "cancel",
        description: "cancel one of your reminders",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "number",
            description: "number shown by /remind list",
            type: ApplicationCommandOptionType.Integer,
            required: true,
            minValue: 1,
            maxValue: MAX_PER_USER,
          },
        ],
      },
    ],
  },

  async messageRun(message, args) {
    const first = args[0].toLowerCase();

    try {
      if (first === "list") {
        return message.safeReply(await renderList(message.guildId, message.author.id));
      }

      if (first === "cancel") {
        const index = Number.parseInt(args[1], 10);
        if (!Number.isInteger(index)) return message.safeReply("Provide the reminder number from `remind list`");
        const cancelled = await cancelReminder({ guildId: message.guildId, userId: message.author.id, index });
        return message.safeReply(`Cancelled: ${reminderSummary(cancelled).slice(0, 100)}`);
      }

      const { remindAt } = await createReminder({
        guildId: message.guildId,
        userId: message.author.id,
        channelId: message.channelId,
        content: args.slice(1).join(" "),
        delayMs: ems(first),
      });

      return message.safeReply(`Got it. I will remind you ${time(remindAt, "R")}.`);
    } catch (ex) {
      if (ex instanceof ReminderError) return message.safeReply(ex.message);
      throw ex;
    }
  },

  async interactionRun(interaction) {
    const sub = interaction.options.getSubcommand();

    try {
      if (sub === "me") {
        const repeat = interaction.options.getString("every");
        const { remindAt } = await createReminder({
          guildId: interaction.guildId,
          userId: interaction.user.id,
          channelId: interaction.channelId,
          content: interaction.options.getString("about"),
          delayMs: ems(interaction.options.getString("in")),
          repeatMs: repeat ? ems(repeat) : null,
          dm: interaction.options.getBoolean("dm") || false,
        });

        return interaction.safeFollowUp(
          `Got it. I will remind you ${time(remindAt, "R")}${repeat ? `, then every ${repeat}` : ""}.`
        );
      }

      if (sub === "list") {
        return interaction.safeFollowUp(await renderList(interaction.guildId, interaction.user.id));
      }

      if (sub === "cancel") {
        const cancelled = await cancelReminder({
          guildId: interaction.guildId,
          userId: interaction.user.id,
          index: interaction.options.getInteger("number"),
        });
        return interaction.safeFollowUp(`Cancelled: ${reminderSummary(cancelled).slice(0, 100)}`);
      }
    } catch (ex) {
      if (ex instanceof ReminderError) return interaction.safeFollowUp(ex.message);
      throw ex;
    }

    return interaction.safeFollowUp("Invalid subcommand");
  },
};

async function renderList(guildId, userId) {
  const reminders = await listReminders({ guildId, userId });
  if (reminders.length === 0) return "You have no pending reminders.";

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLORS.BOT_EMBED)
    .setAuthor({ name: "Your reminders" })
    .setDescription(reminders.map((reminder, index) => describeReminder(reminder, index + 1)).join("\n\n"))
    .setFooter({ text: "Cancel one with /remind cancel <number>" });

  return { embeds: [embed] };
}
