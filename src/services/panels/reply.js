/**
 * Answering a click in the time Discord allows.
 *
 * Discord gives three seconds to acknowledge a component click, and tells the
 * member "the application did not respond" the moment that passes. Three seconds
 * is plenty for redrawing a panel from what is already in memory — and not always
 * enough for a panel that has to ask the database first: listing a server's feeds,
 * counting what each system holds, reading a sticky message back.
 *
 * So anything with work to do acknowledges the click first and edits the message
 * when the answer is ready. The member sees the same thing either way; the
 * difference is that the click is never left hanging.
 */

/**
 * Tell Discord the click was received, without changing anything yet.
 *
 * @param {import('discord.js').MessageComponentInteraction} interaction
 */
async function ack(interaction) {
  if (interaction.deferred || interaction.replied) return;
  await interaction.deferUpdate();
}

/**
 * Draw a panel into the message the click came from, whether or not the click has
 * already been acknowledged.
 *
 * @param {import('discord.js').MessageComponentInteraction} interaction
 * @param {object} payload embeds and components
 */
function redraw(interaction, payload) {
  if (interaction.deferred || interaction.replied) return interaction.editReply(payload);
  return interaction.update(payload);
}

// How long something may take before the click is acknowledged without it.
const PATIENCE_MS = 1200;

/**
 * The whole pattern in one call: build, draw, and acknowledge on the way if the
 * building takes long enough to be at risk.
 *
 * Acknowledging first is the safe order and a visible cost: from the click until
 * the message is edited, Discord greys out every button on it. A panel read from
 * a warm cache comes back in milliseconds, so paying that on every click makes
 * the whole panel feel like it is catching up. The acknowledgement is kept for
 * the clicks that actually need it.
 *
 * @param {import('discord.js').MessageComponentInteraction} interaction
 * @param {() => Promise<object>|object} build
 * @param {number} [patience]
 */
async function slowRedraw(interaction, build, patience = PATIENCE_MS) {
  const payload = await ackIfSlow(interaction, (async () => build())(), patience);
  return redraw(interaction, payload);
}

/**
 * Wait for something, acknowledging the click if it takes too long.
 *
 * Used for work that is usually instant and occasionally not — reading the guild
 * settings is a cache hit almost every time, and a database round-trip right
 * after a restart. Rather than paying for an acknowledgement on every click or
 * gambling on the slow case, the click is acknowledged only once it is at risk.
 *
 * @template T
 * @param {import('discord.js').MessageComponentInteraction} interaction
 * @param {Promise<T>} work
 * @param {number} [patience]
 * @returns {Promise<T>}
 */
async function ackIfSlow(interaction, work, patience = PATIENCE_MS) {
  let timer;
  const late = new Promise((resolve) => {
    timer = setTimeout(() => resolve("late"), patience);
    timer.unref?.();
  });

  const finished = await Promise.race([work.then(() => "done"), late]);
  clearTimeout(timer);

  if (finished === "late") await ack(interaction).catch(() => {});
  return work;
}

/**
 * Say something to whoever clicked, without touching the panel.
 *
 * @param {import('discord.js').MessageComponentInteraction} interaction
 * @param {string} content
 */
function warn(interaction, content) {
  const payload = { content, ephemeral: true };
  return interaction.deferred || interaction.replied ? interaction.followUp(payload) : interaction.reply(payload);
}

/**
 * Run a panel and make sure the click is answered either way.
 *
 * A panel reads whatever a server has stored, and stored data can be older than
 * the code reading it. Left alone, one unexpected value throws, nothing answers,
 * and the member is told the application did not respond — which says nothing
 * about what happened and looks like the button is broken. Saying so plainly, and
 * putting the reason in the log, is better on both counts.
 *
 * @param {import('discord.js').MessageComponentInteraction} interaction
 * @param {() => Promise<boolean>} work
 * @param {{message: string, logger?: object, label?: string}} context
 * @returns {Promise<boolean>}
 */
async function guard(interaction, work, { message, logger, label = "panel" }) {
  try {
    return await work();
  } catch (error) {
    // A click Discord has already given up on cannot be answered at all.
    if (expired(error)) {
      logger?.debug?.(`${label}: interaction expired (${interaction.customId})`);
      return true;
    }

    logger?.error?.(`${label}: ${interaction.customId}`, error);
    await warn(interaction, message).catch(() => {});
    return true;
  }
}

/**
 * Whether an error means the interaction is gone rather than that we did
 * something wrong: it expired, or it was already answered.
 *
 * @param {any} error
 */
function expired(error) {
  // 10062 Unknown interaction, 40060 Interaction has already been acknowledged.
  return error?.code === 10062 || error?.code === 40060 || error?.code === "InteractionAlreadyReplied";
}

module.exports = { PATIENCE_MS, ack, ackIfSlow, expired, guard, redraw, slowRedraw, warn };
