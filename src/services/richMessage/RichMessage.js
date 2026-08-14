const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require("discord.js");
const {
  MAX_BUTTONS,
  MAX_BUTTON_LABEL,
  MAX_FIELDS,
  MAX_FIELD_NAME,
  MAX_FIELD_VALUE,
  MAX_POLL_DURATION_MINUTES,
  MAX_POLL_OPTIONS,
  MAX_POLL_OPTION_LABEL,
  MAX_POLL_QUESTION,
} = require("@schemas/RichMessage");
const { startPoll } = require("@helpers/Polls");

/**
 * Turning a stored rich-message config into what Discord actually takes, and
 * turning a dashboard form back into that stored config.
 *
 * This is the one place either direction happens, so a custom command's
 * message action and a server's welcome greeting build their embed, fields and
 * buttons the same way, with the same limits, rather than two versions slowly
 * drifting apart. Nothing here runs a template through anything but plain
 * string substitution — the `renderText` callback each caller supplies is
 * their own variable substitution, never code.
 */

const MAX_CONTENT = 2000;
const MAX_EMBED_TITLE = 256;
const MAX_EMBED_DESCRIPTION = 4096;
const MAX_AUTHOR = 256;
const MAX_FOOTER = 2048;
const HTTPS = /^https:\/\//i;
const COLOR = /^#[0-9a-f]{6}$/i;

class RichMessageError extends Error {
  constructor(message) {
    super(message);
    this.name = "RichMessageError";
  }
}

/**
 * @param {string} value
 * @param {(text: string) => (string|Promise<string>)} [renderText]
 * @returns {Promise<string|null>}
 */
async function renderMaybe(value, renderText) {
  if (!value) return null;
  const rendered = renderText ? await renderText(value) : value;
  const text = String(rendered ?? "").trim();
  return text || null;
}

/**
 * @param {object[]} fields stored `{name, value, inline}` entries
 * @param {Function} [renderText]
 * @returns {Promise<{name: string, value: string, inline: boolean}[]>}
 */
async function buildFields(fields, renderText) {
  const built = [];
  for (const field of fields || []) {
    const name = await renderMaybe(field.name, renderText);
    const value = await renderMaybe(field.value, renderText);
    // Discord rejects the whole embed when one field has an empty name or
    // value; dropping just that field keeps the rest of the message alive.
    if (!name || !value) continue;
    built.push({ name: name.slice(0, MAX_FIELD_NAME), value: value.slice(0, MAX_FIELD_VALUE), inline: Boolean(field.inline) });
    if (built.length >= MAX_FIELDS) break;
  }
  return built;
}

/**
 * @param {object} config `{title, description, author, footer, thumbnail, image, color, timestamp, fields}`
 * @param {Function} [renderText]
 * @returns {Promise<import('discord.js').EmbedBuilder|null>} null when there is nothing to show
 */
async function buildEmbed(config, renderText) {
  if (!config) return null;

  const title = await renderMaybe(config.title, renderText);
  const description = await renderMaybe(config.description, renderText);
  const author = await renderMaybe(config.author, renderText);
  const footer = await renderMaybe(config.footer, renderText);
  const thumbnail = await renderMaybe(config.thumbnail, renderText);
  const image = await renderMaybe(config.image, renderText);
  const fields = await buildFields(config.fields, renderText);

  const hasContent = title || description || author || footer || thumbnail || image || fields.length || config.timestamp;
  if (!hasContent) return null;

  const embed = new EmbedBuilder();
  if (title) embed.setTitle(title.slice(0, MAX_EMBED_TITLE));
  if (description) embed.setDescription(description.slice(0, MAX_EMBED_DESCRIPTION));
  if (author) embed.setAuthor({ name: author.slice(0, MAX_AUTHOR) });
  if (footer) embed.setFooter({ text: footer.slice(0, MAX_FOOTER) });
  if (thumbnail && HTTPS.test(thumbnail)) embed.setThumbnail(thumbnail);
  if (image && HTTPS.test(image)) embed.setImage(image);
  if (fields.length) embed.addFields(fields);
  if (config.color && COLOR.test(config.color)) embed.setColor(config.color);
  if (config.timestamp) embed.setTimestamp();
  return embed;
}

/**
 * Link buttons only: opening a URL needs nothing further from the bot, where
 * any other style would need an interaction handler and a real action behind
 * it that a static message does not have.
 *
 * @param {object[]} buttons stored `{label, url, emoji}` entries
 * @param {Function} [renderText]
 * @returns {Promise<import('discord.js').ActionRowBuilder[]>} zero or one row
 */
async function buildLinkButtons(buttons, renderText) {
  const usable = [];
  for (const button of (buttons || []).slice(0, MAX_BUTTONS)) {
    const label = await renderMaybe(button.label, renderText);
    const url = await renderMaybe(button.url, renderText);
    // A button missing a real label or a safe url is dropped, not sent broken.
    if (!label || !url || !HTTPS.test(url)) continue;
    const built = new ButtonBuilder().setLabel(label.slice(0, MAX_BUTTON_LABEL)).setStyle(ButtonStyle.Link).setURL(url);
    if (button.emoji) built.setEmoji(String(button.emoji));
    usable.push(built);
  }
  return usable.length ? [new ActionRowBuilder().addComponents(usable)] : [];
}

/**
 * A full sendable payload for a stored rich message, everything except a poll
 * (a poll is its own message, started separately, since it needs a real
 * channel to post into and a database record rather than a one-off payload).
 *
 * @param {object} config `{content, title, description, ..., tts}`
 * @param {Function} [renderText]
 * @param {{selfMention?: string, roleMentions?: string[]}} [mentions]
 * @returns {Promise<object|null>} null when the message would be empty
 */
async function buildPayload(config, renderText, mentions = {}) {
  const content = (await renderMaybe(config?.content, renderText))?.slice(0, MAX_CONTENT) || null;
  const embed = await buildEmbed(config, renderText);
  const buttons = await buildLinkButtons(config?.buttons, renderText);

  if (!content && !embed) return null;

  return {
    content,
    embeds: embed ? [embed] : [],
    components: buttons,
    tts: Boolean(config?.tts),
    allowedMentions: {
      users: mentions.selfMention ? [mentions.selfMention] : [],
      roles: mentions.roleMentions || [],
      parse: [],
    },
  };
}

/**
 * Delete a sent message after its configured delay, the same way every
 * consumer of a rich message does it.
 *
 * @param {import('discord.js').Message} sent
 * @param {number} seconds
 */
function scheduleDeletion(sent, seconds) {
  const delay = Math.min(86400, Math.max(0, Number(seconds) || 0));
  if (!sent?.delete || !delay) return;
  setTimeout(() => sent.delete().catch(() => {}), delay * 1000).unref?.();
}

/**
 * Start the poll a rich message was configured with, reusing the same poll
 * engine `/poll create` uses — the same embed, the same vote buttons, the same
 * scheduled auto-close.
 *
 * @param {Object} input
 * @param {import('discord.js').Guild} input.guild
 * @param {import('discord.js').GuildTextBasedChannel} input.channel
 * @param {string} input.authorId
 * @param {{question: string, options: string[], multi?: boolean, duration_minutes?: number|null}} input.poll
 * @returns {Promise<{poll: object, message: import('discord.js').Message}|null>} null when there is no poll configured
 */
async function startPollFromConfig({ guild, channel, authorId, poll }) {
  if (!poll?.question || !poll?.options?.length) return null;
  return startPoll({
    guild,
    channel,
    authorId,
    question: poll.question,
    optionsInput: poll.options.join("|"),
    multi: Boolean(poll.multi),
    durationMs: poll.duration_minutes ? poll.duration_minutes * 60_000 : null,
  });
}

/* ------------------------------------------------------------ dashboard input */

/**
 * One line of a fields textarea: `name | value | inline?`.
 *
 * @param {string} raw
 * @param {number} [max]
 * @returns {{name: string, value: string, inline: boolean}[]}
 */
function sanitizeFields(raw, max = MAX_FIELDS) {
  const lines = String(raw || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length > max) throw new RichMessageError(`A message can have at most ${max} fields.`);

  return lines.map((line) => {
    const [rawName, rawValue, rawInline] = line.split("|").map((part) => part.trim());
    const name = String(rawName || "").slice(0, MAX_FIELD_NAME);
    const value = String(rawValue || "").slice(0, MAX_FIELD_VALUE);
    if (!name || !value) {
      throw new RichMessageError('Each field needs a name and a value, e.g. "Rules | Read #rules first".');
    }
    return { name, value, inline: String(rawInline || "").toLowerCase() === "inline" };
  });
}

/**
 * One line of a buttons textarea: `label | https://... | emoji?`.
 *
 * @param {string} raw
 * @param {number} [max]
 * @returns {{label: string, url: string, emoji: string|null}[]}
 */
function sanitizeButtons(raw, max = MAX_BUTTONS) {
  const lines = String(raw || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length > max) throw new RichMessageError(`A message can have at most ${max} buttons.`);

  return lines.map((line) => {
    const [rawLabel, rawUrl, rawEmoji] = line.split("|").map((part) => part.trim());
    const label = String(rawLabel || "").slice(0, MAX_BUTTON_LABEL);
    const url = String(rawUrl || "");
    if (!label || !HTTPS.test(url)) {
      throw new RichMessageError('Each button needs a label and an https link, e.g. "Support | https://discord.gg/...".');
    }
    return { label, url: url.slice(0, 512), emoji: rawEmoji ? String(rawEmoji).slice(0, 100) : null };
  });
}

/**
 * A poll from dashboard form input, or null when the admin left it blank.
 *
 * @param {{pollQuestion?: string, pollOptions?: string, pollMulti?: string, pollDuration?: string}} input
 * @returns {{question: string, options: string[], multi: boolean, duration_minutes: number|null}|null}
 */
function sanitizePoll(input) {
  const question = String(input?.pollQuestion || "").trim().slice(0, MAX_POLL_QUESTION);
  const options = String(input?.pollOptions || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, MAX_POLL_OPTIONS)
    .map((line) => line.slice(0, MAX_POLL_OPTION_LABEL));

  if (!question && !options.length) return null;
  if (!question) throw new RichMessageError("A poll needs a question.");
  if (options.length < 2) throw new RichMessageError("A poll needs at least two options, one per line.");

  const rawDuration = String(input?.pollDuration || "").trim();
  const duration = rawDuration ? Number.parseInt(rawDuration, 10) : null;
  if (rawDuration && !Number.isFinite(duration)) throw new RichMessageError("Provide the poll duration in minutes.");

  return {
    question,
    options,
    multi: input?.pollMulti === "on",
    duration_minutes: duration ? Math.min(MAX_POLL_DURATION_MINUTES, Math.max(1, duration)) : null,
  };
}

/**
 * The stored shape, back into the compact line format the textarea shows.
 *
 * @param {object[]} fields
 * @returns {string}
 */
function stringifyFields(fields) {
  return (fields || []).map((field) => `${field.name} | ${field.value}${field.inline ? " | inline" : ""}`).join("\n");
}

/**
 * @param {object[]} buttons
 * @returns {string}
 */
function stringifyButtons(buttons) {
  return (buttons || []).map((button) => `${button.label} | ${button.url}${button.emoji ? ` | ${button.emoji}` : ""}`).join("\n");
}

module.exports = {
  MAX_CONTENT,
  RichMessageError,
  buildEmbed,
  buildFields,
  buildLinkButtons,
  buildPayload,
  sanitizeButtons,
  sanitizeFields,
  sanitizePoll,
  scheduleDeletion,
  startPollFromConfig,
  stringifyButtons,
  stringifyFields,
};
