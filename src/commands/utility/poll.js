const { ApplicationCommandOptionType, ChannelType, EmbedBuilder } = require("discord.js");
const ems = require("enhanced-ms");
const { EMBED_COLORS } = require("@root/config");
const { MAX_OPTIONS, createPoll, listOpenPolls, getPoll } = require("@schemas/Poll");
const { PollError, assertQuestion, buildPollComponents, buildPollEmbed, parseOptions } = require("@helpers/Polls");
const { pollHandler } = require("@src/handlers");
const { scheduleTask } = require("@schemas/ScheduledTask");

const MIN_DURATION_MS = 60_000;
const MAX_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * @type {import("@structures/Command")}
 */
module.exports = {
  name: "poll",
  description: "run a poll with buttons and live results",
  category: "UTILITY",
  botPermissions: ["EmbedLinks"],
  cooldown: 5,
  command: {
    enabled: true,
    usage: '"<question>" <option | option | ...>',
    minArgsCount: 2,
    subcommands: [
      { trigger: "<question> | <option> | <option>", description: "start a poll in this channel" },
      { trigger: "list", description: "list the open polls of this server" },
      { trigger: "close <messageId>", description: "close a poll and show the result" },
    ],
  },
  slashCommand: {
    enabled: true,
    options: [
      {
        name: "create",
        description: "start a poll",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "question",
            description: "the question to ask",
            type: ApplicationCommandOptionType.String,
            required: true,
          },
          {
            name: "options",
            description: `up to ${MAX_OPTIONS} options separated by | for example: yes | no | maybe`,
            type: ApplicationCommandOptionType.String,
            required: true,
          },
          {
            name: "multi",
            description: "let members pick several options",
            type: ApplicationCommandOptionType.Boolean,
            required: false,
          },
          {
            name: "duration",
            description: "close automatically after this time, e.g. 2h",
            type: ApplicationCommandOptionType.String,
            required: false,
          },
          {
            name: "show_voters",
            description: "show who voted for what",
            type: ApplicationCommandOptionType.Boolean,
            required: false,
          },
          {
            name: "final",
            description: "do not allow members to change their vote",
            type: ApplicationCommandOptionType.Boolean,
            required: false,
          },
          {
            name: "channel",
            description: "channel to post the poll in",
            type: ApplicationCommandOptionType.Channel,
            channelTypes: [ChannelType.GuildText, ChannelType.GuildAnnouncement],
            required: false,
          },
        ],
      },
      {
        name: "list",
        description: "list the open polls of this server",
        type: ApplicationCommandOptionType.Subcommand,
      },
      {
        name: "close",
        description: "close a poll and show the result",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "message_id",
            description: "message id of the poll",
            type: ApplicationCommandOptionType.String,
            required: true,
          },
        ],
      },
    ],
  },

  async messageRun(message, args) {
    const first = args[0].toLowerCase();

    try {
      if (first === "list") return message.safeReply(await renderOpenPolls(message.guild));

      if (first === "close") {
        return message.safeReply(await close(message, args[1], message.author.id));
      }

      // "question | option | option"
      const [question, ...rest] = args.join(" ").split("|");
      const poll = await start({
        guild: message.guild,
        channel: message.channel,
        authorId: message.author.id,
        question,
        optionsInput: rest.join("|"),
      });

      return poll.reply;
    } catch (ex) {
      if (ex instanceof PollError) return message.safeReply(ex.message);
      throw ex;
    }
  },

  async interactionRun(interaction) {
    const sub = interaction.options.getSubcommand();

    try {
      if (sub === "create") {
        const channel = interaction.options.getChannel("channel") || interaction.channel;
        const duration = interaction.options.getString("duration");

        const { reply } = await start({
          guild: interaction.guild,
          channel,
          authorId: interaction.user.id,
          question: interaction.options.getString("question"),
          optionsInput: interaction.options.getString("options"),
          multi: interaction.options.getBoolean("multi") || false,
          anonymous: !interaction.options.getBoolean("show_voters"),
          allowChange: !interaction.options.getBoolean("final"),
          durationMs: duration ? ems(duration) : null,
        });

        return interaction.safeFollowUp(reply);
      }

      if (sub === "list") return interaction.safeFollowUp(await renderOpenPolls(interaction.guild));

      if (sub === "close") {
        return interaction.safeFollowUp(
          await close(interaction, interaction.options.getString("message_id"), interaction.user.id)
        );
      }
    } catch (ex) {
      if (ex instanceof PollError) return interaction.safeFollowUp(ex.message);
      throw ex;
    }

    return interaction.safeFollowUp("Invalid subcommand");
  },
};

async function start({
  guild,
  channel,
  authorId,
  question,
  optionsInput,
  multi = false,
  anonymous = true,
  allowChange = true,
  durationMs = null,
}) {
  const text = assertQuestion(question);
  const options = parseOptions(optionsInput);

  if (!channel.isTextBased()) throw new PollError("Polls only work in text channels.");
  if (!channel.permissionsFor(guild.members.me)?.has(["ViewChannel", "SendMessages", "EmbedLinks"])) {
    throw new PollError(`I need to view, send messages and embed links in ${channel}.`);
  }

  if (durationMs !== null) {
    if (!Number.isFinite(durationMs)) throw new PollError("Provide a duration such as `2h` or `3d`.");
    if (durationMs < MIN_DURATION_MS) throw new PollError("A poll must run for at least a minute.");
    if (durationMs > MAX_DURATION_MS) throw new PollError("A poll cannot run longer than 30 days.");
  }

  const endsAt = durationMs ? new Date(Date.now() + durationMs) : null;

  // Post first, then store: the message id is the poll's identity.
  const draft = {
    message_id: "pending",
    question: text,
    options,
    votes: new Map(),
    multi,
    anonymous,
    allow_change: allowChange,
    ends_at: endsAt,
    closed: false,
  };

  const message = await channel.send({ embeds: [buildPollEmbed(draft)] });

  const poll = await createPoll({
    guild_id: guild.id,
    channel_id: channel.id,
    message_id: message.id,
    author_id: authorId,
    question: text,
    options,
    multi,
    anonymous,
    allow_change: allowChange,
    ends_at: endsAt,
  });

  await message.edit({ embeds: [buildPollEmbed(poll)], components: buildPollComponents(poll) });

  if (endsAt) {
    await scheduleTask({
      type: pollHandler.TASK_TYPE,
      guildId: guild.id,
      runAt: endsAt,
      payload: { channelId: channel.id, messageId: message.id },
    });
  }

  return {
    poll,
    reply: `Poll started in ${channel}${endsAt ? `, closing <t:${Math.floor(endsAt.getTime() / 1000)}:R>` : ""}.`,
  };
}

async function close(source, messageId, userId) {
  if (!messageId) return "Provide the message id of the poll.";

  const poll = await getPoll(source.guild.id, messageId);
  if (!poll) return "No poll found with that message id.";
  if (poll.closed) return "That poll is already closed.";

  const member = source.member;
  if (poll.author_id !== userId && !member.permissions.has("ManageMessages")) {
    return "Only the poll author or staff can close this poll.";
  }

  await pollHandler.finishPoll(source.client, {
    guildId: source.guild.id,
    channelId: poll.channel_id,
    messageId: poll.message_id,
  });

  return "Poll closed.";
}

async function renderOpenPolls(guild) {
  const polls = await listOpenPolls(guild.id);
  if (polls.length === 0) return "No open polls.";

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLORS.BOT_EMBED)
    .setAuthor({ name: `Open polls · ${guild.name}` })
    .setDescription(
      polls
        .map(
          (poll) =>
            `**${poll.question.slice(0, 80)}**\n-# <#${poll.channel_id}> · \`${poll.message_id}\`` +
            `${poll.ends_at ? ` · closes <t:${Math.floor(new Date(poll.ends_at).getTime() / 1000)}:R>` : ""}`
        )
        .join("\n\n")
        .slice(0, 4000)
    );

  return { embeds: [embed] };
}
