const { performAutomod } = require("@handlers/automod");

/** The extra method the interactive command offers besides plain purges. */
const AUTOMOD_METHOD = Object.freeze({ id: "automod", emoji: "🛡️" });

const MAX_PER_CHANNEL = 100;
const MAX_CHANNELS = 25;
const MAX_RESULT_CHANNELS = 25;
const DEFAULT_BUDGET_MS = 10 * 60 * 1000;
const REQUIRED_PERMISSIONS = ["ManageMessages", "ReadMessageHistory"];

/**
 * Fetch the authors a scan is about to moderate. A fetched message resolves its
 * member from the guild cache, and automod needs that member to apply strikes
 * and to decide whether the author is a moderator.
 *
 * @param {import('discord.js').Guild} guild
 * @param {Array<import('discord.js').Message>} messages
 */
async function cacheMembers(guild, messages) {
  const ids = new Set(messages.filter((message) => !message.author.bot).map((message) => message.author.id));
  await Promise.all(
    [...ids].filter((id) => !guild.members.cache.has(id)).map((id) => guild.members.fetch(id).catch(() => null))
  );
}

/**
 * Run the server's automod over the recent history of the selected channels,
 * with the same detection, strikes and escalation as live moderation.
 *
 * Scans stop at a deadline rather than running for an unbounded time: image
 * classification takes seconds per picture, and an interaction has a limited
 * window to report back. Whatever was not reached is reported as partial.
 *
 * @param {object} options
 * @param {import('discord.js').GuildMember} options.issuer
 * @param {Array} options.channels
 * @param {number|string} options.amount messages per channel
 * @param {object} options.settings guild settings
 * @param {Function} [options.perform] automod implementation, injectable for tests
 * @param {Function} [options.onProgress]
 * @param {Function} [options.now]
 * @param {number} [options.budgetMs]
 * @returns {Promise<object>}
 */
async function runChannelAutomod({
  issuer,
  channels,
  amount,
  settings,
  perform = performAutomod,
  onProgress,
  now = Date.now,
  budgetMs = DEFAULT_BUDGET_MS,
}) {
  const requested = Number.parseInt(amount, 10);
  if (!Number.isInteger(requested) || requested < 1) return { error: "INVALID_AMOUNT", results: [] };

  const perChannel = Math.min(requested, MAX_PER_CHANNEL);
  const selected = channels.slice(0, MAX_CHANNELS);
  const deadline = now() + budgetMs;
  const results = [];
  let checked = 0;
  let deleted = 0;
  let strikes = 0;
  let triggered = 0;
  let failed = 0;
  let partial = false;

  for (const channel of selected) {
    if (partial || now() >= deadline) {
      partial = true;
      results.push({ channelId: channel?.id || null, name: channel?.name || "", status: "SKIPPED", checked: 0 });
      continue;
    }

    const base = { channelId: channel?.id || null, name: channel?.name || "" };
    try {
      if (!channel.permissionsFor(issuer)?.has(REQUIRED_PERMISSIONS)) {
        results.push({ ...base, status: "MEMBER_PERM", checked: 0 });
        continue;
      }
      if (!channel.permissionsFor(channel.guild.members.me)?.has(REQUIRED_PERMISSIONS)) {
        results.push({ ...base, status: "BOT_PERM", checked: 0 });
        continue;
      }
    } catch {
      results.push({ ...base, status: "ERROR", checked: 0 });
      continue;
    }

    let fetched;
    try {
      fetched = await channel.messages.fetch({ limit: perChannel, cache: false, force: true });
    } catch {
      results.push({ ...base, status: "ERROR", checked: 0 });
      continue;
    }

    // Discord returns the newest messages first; moderation should replay the
    // history in the order it was written.
    const messages = [...fetched.values()].reverse();
    if (messages.length === 0) {
      results.push({ ...base, status: "NO_MESSAGES", checked: 0 });
      continue;
    }

    try {
      await cacheMembers(channel.guild, messages);
    } catch {
      // A missing member cache only skips those messages; it must not abort the scan.
    }

    const channelResult = {
      ...base,
      status: "OK",
      checked: 0,
      deleted: 0,
      strikes: 0,
      triggered: 0,
      failed: 0,
      skipped: 0,
    };

    for (const message of messages) {
      if (now() >= deadline) {
        partial = true;
        channelResult.status = "PARTIAL";
        break;
      }
      if (message.author.bot || !message.member) {
        channelResult.skipped += 1;
        continue;
      }

      try {
        const outcome = await perform(message, settings, undefined, undefined, {
          skipAntiSpam: true,
          silent: true,
        });
        channelResult.checked += 1;
        if (outcome?.deleted) channelResult.deleted += 1;
        channelResult.strikes += Number(outcome?.strikes) || 0;
        if (outcome?.triggered) channelResult.triggered += 1;
      } catch {
        channelResult.failed += 1;
      }

      onProgress?.({
        channelId: channel.id,
        channelName: channel.name,
        checked: channelResult.checked,
        total: messages.length,
        deleted: deleted + channelResult.deleted,
        strikes: strikes + channelResult.strikes,
      });
    }

    checked += channelResult.checked;
    deleted += channelResult.deleted;
    strikes += channelResult.strikes;
    triggered += channelResult.triggered;
    failed += channelResult.failed;
    results.push(channelResult);
  }

  return {
    results: results.slice(0, MAX_RESULT_CHANNELS),
    checked,
    deleted,
    strikes,
    triggered,
    failed,
    partial,
  };
}

module.exports = {
  AUTOMOD_METHOD,
  DEFAULT_BUDGET_MS,
  MAX_PER_CHANNEL,
  runChannelAutomod,
};
