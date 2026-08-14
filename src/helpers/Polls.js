const {
  ActionRowBuilder,
  EmbedBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  time,
} = require("discord.js");
const { EMBED_COLORS } = require("@root/config");
const { MAX_OPTIONS, MAX_OPTION_LABEL, MAX_QUESTION, createPoll } = require("@schemas/Poll");
const { scheduleTask } = require("@schemas/ScheduledTask");

const VOTE_PREFIX = "POLL_VOTE";
const CLOSE_PREFIX = "POLL_CLOSE";
// The scheduled-task type a poll's auto-close is filed under. Defined here
// rather than imported from the handler that registers it, since that handler
// requires this module for the embed/component builders - importing it back
// would be a cycle for the sake of one string both sides already agree on.
const POLL_CLOSE_TASK_TYPE = "POLL_CLOSE";
const MIN_DURATION_MS = 60_000;
const MAX_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
const BAR_LENGTH = 12;
const DEFAULT_EMOJIS = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];

class PollError extends Error {
  constructor(message) {
    super(message);
    this.name = "PollError";
  }
}

/**
 * Split the option list a user typed. `|` separates options so labels may contain commas.
 * @param {string} input
 * @returns {{label: string, emoji: string|null}[]}
 */
function parseOptions(input) {
  const labels = String(input || "")
    .split("|")
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (labels.length < 2) throw new PollError("A poll needs at least two options, separated by `|`.");
  if (labels.length > MAX_OPTIONS) throw new PollError(`A poll can have at most ${MAX_OPTIONS} options.`);

  const seen = new Set();
  return labels.map((label, index) => {
    const trimmed = label.slice(0, MAX_OPTION_LABEL);
    const key = trimmed.toLowerCase();
    if (seen.has(key)) throw new PollError(`Option "${trimmed}" is listed twice.`);
    seen.add(key);
    return { label: trimmed, emoji: DEFAULT_EMOJIS[index] };
  });
}

/**
 * @param {string} question
 */
function assertQuestion(question) {
  const trimmed = String(question || "").trim();
  if (!trimmed) throw new PollError("Ask a question.");
  if (trimmed.length > MAX_QUESTION) throw new PollError(`Keep the question under ${MAX_QUESTION} characters.`);
  return trimmed;
}

/**
 * Turn the stored vote map into per-option counts.
 *
 * Pure, so the tally shown to members and the tally used for the result are the
 * same code path.
 *
 * @param {{options: Array, votes: Map<string, number[]>|object}} poll
 * @returns {{counts: number[], total: number, voters: number, voterIds: string[][]}}
 */
function tally(poll) {
  const counts = new Array(poll.options.length).fill(0);
  const voterIds = poll.options.map(() => []);
  const entries = poll.votes instanceof Map ? [...poll.votes.entries()] : Object.entries(poll.votes || {});

  for (const [userId, picks] of entries) {
    for (const index of picks || []) {
      if (index >= 0 && index < counts.length) {
        counts[index] += 1;
        voterIds[index].push(userId);
      }
    }
  }

  return {
    counts,
    total: counts.reduce((sum, value) => sum + value, 0),
    voters: entries.filter(([, picks]) => (picks || []).length > 0).length,
    voterIds,
  };
}

/**
 * Apply a vote and report what changed.
 *
 * @param {{poll: object, userId: string, selected: number[]}} input
 * @returns {{picks: number[], error: string|null}}
 */
function applyVote({ poll, userId, selected }) {
  if (poll.closed) return { picks: [], error: "This poll is closed." };

  const valid = (selected || []).filter(
    (index) => Number.isInteger(index) && index >= 0 && index < poll.options.length
  );
  if (valid.length === 0) return { picks: [], error: "Pick at least one option." };
  if (!poll.multi && valid.length > 1) return { picks: [], error: "This poll allows a single choice." };

  const existing = (poll.votes instanceof Map ? poll.votes.get(userId) : poll.votes?.[userId]) || [];

  if (existing.length > 0 && !poll.allow_change) {
    return { picks: existing, error: "You already voted and this poll does not allow changes." };
  }

  // Single choice replaces; multiple choice toggles the clicked options.
  if (!poll.multi) return { picks: valid, error: null };

  const next = new Set(existing);
  for (const index of valid) {
    if (next.has(index)) next.delete(index);
    else next.add(index);
  }

  return { picks: [...next].sort((a, b) => a - b), error: null };
}

/**
 * @param {number} count
 * @param {number} total
 */
function bar(count, total) {
  const ratio = total === 0 ? 0 : count / total;
  const filled = Math.round(ratio * BAR_LENGTH);
  return `${"█".repeat(filled)}${"░".repeat(BAR_LENGTH - filled)} ${Math.round(ratio * 100)}%`;
}

/**
 * @param {object} poll
 * @param {{showVoters?: boolean}} options
 */
function buildPollEmbed(poll, { showVoters = false } = {}) {
  const { counts, total, voters, voterIds } = tally(poll);

  const lines = poll.options.map((option, index) => {
    const detail =
      showVoters && voterIds[index].length ? `\n-# ${voterIds[index].map((id) => `<@${id}>`).join(", ")}` : "";
    return `${option.emoji || ""} **${option.label}** — ${counts[index]}\n${bar(counts[index], total)}${detail}`;
  });

  const footer = [];
  footer.push(poll.multi ? "multiple choice" : "single choice");
  if (poll.anonymous) footer.push("anonymous");
  if (!poll.allow_change) footer.push("votes are final");

  const embed = new EmbedBuilder()
    .setColor(poll.closed ? EMBED_COLORS.WARNING : EMBED_COLORS.BOT_EMBED)
    .setAuthor({ name: poll.closed ? "Poll · closed" : "Poll" })
    .setTitle(poll.question)
    .setDescription(lines.join("\n\n"))
    .setFooter({ text: `${voters} voter${voters === 1 ? "" : "s"} · ${footer.join(" · ")}` });

  if (poll.ends_at && !poll.closed) {
    embed.addFields({ name: "Closes", value: `${time(new Date(poll.ends_at), "R")}`, inline: true });
  }

  return embed;
}

/**
 * @param {object} poll
 */
function buildPollComponents(poll) {
  if (poll.closed) return [];

  const select = new StringSelectMenuBuilder()
    .setCustomId(`${VOTE_PREFIX}:${poll.message_id}`)
    .setPlaceholder(poll.multi ? "Pick one or more options" : "Pick an option")
    .setMinValues(1)
    .setMaxValues(poll.multi ? poll.options.length : 1)
    .addOptions(
      poll.options.map((option, index) => ({
        label: option.label,
        value: String(index),
        emoji: option.emoji || undefined,
      }))
    );

  return [
    new ActionRowBuilder().addComponents(select),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${CLOSE_PREFIX}:${poll.message_id}`)
        .setLabel("Close poll")
        .setStyle(ButtonStyle.Secondary)
        .setEmoji("🔒")
    ),
  ];
}

/**
 * @param {object} poll
 */
function buildResultSummary(poll) {
  const { counts, total } = tally(poll);
  if (total === 0) return "Nobody voted.";

  const best = Math.max(...counts);
  const winners = poll.options.filter((_, index) => counts[index] === best).map((option) => option.label);

  return winners.length === 1
    ? `**${winners[0]}** wins with ${best} of ${total} vote${total === 1 ? "" : "s"}.`
    : `Tie between ${winners.map((label) => `**${label}**`).join(", ")} with ${best} vote${best === 1 ? "" : "s"} each.`;
}

/**
 * Post a poll and hand back the message that carries it — the one poll engine
 * behind both `/poll create` and a rich message's own poll option, so a vote
 * cast on either looks and behaves identically.
 *
 * @param {Object} input
 * @param {import('discord.js').Guild} input.guild
 * @param {import('discord.js').GuildTextBasedChannel} input.channel
 * @param {string} input.authorId
 * @param {string} input.question
 * @param {string} input.optionsInput options separated by `|`
 * @param {boolean} [input.multi]
 * @param {boolean} [input.anonymous]
 * @param {boolean} [input.allowChange]
 * @param {number|null} [input.durationMs]
 * @returns {Promise<{poll: object, message: import('discord.js').Message}>}
 */
async function startPoll({
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
      type: POLL_CLOSE_TASK_TYPE,
      guildId: guild.id,
      runAt: endsAt,
      payload: { channelId: channel.id, messageId: message.id },
    });
  }

  return { poll, message };
}

module.exports = {
  CLOSE_PREFIX,
  DEFAULT_EMOJIS,
  MAX_DURATION_MS,
  MIN_DURATION_MS,
  POLL_CLOSE_TASK_TYPE,
  PollError,
  VOTE_PREFIX,
  applyVote,
  assertQuestion,
  bar,
  buildPollComponents,
  buildPollEmbed,
  buildResultSummary,
  parseOptions,
  startPoll,
  tally,
};
