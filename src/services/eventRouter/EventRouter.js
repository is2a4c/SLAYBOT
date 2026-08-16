const { getSettings } = require("@schemas/Guild");
const { createEventLog } = require("@schemas/EventLog");
const { EVENT_DEFAULT_TEMPLATE, EVENT_TYPES } = require("./catalog");

/**
 * Routing a server's own events to a channel of its own.
 *
 * Every event is recorded first, whether or not the server ever turned a
 * route on for it - the audit trail is about what happened, not about
 * whether anyone asked to be told. Only after that does a route, if one is
 * enabled and its channel still exists, get a message of its own.
 */

const MAX_CONTENT = 2000;

/**
 * Plain string substitution, the same convention used everywhere else a
 * server writes its own template: a name for a value, nothing that could run.
 *
 * @param {string} template
 * @param {{actor?: object, target?: object, detail?: string, reason?: string, guildName?: string}} context
 * @returns {string}
 */
function renderEventTemplate(template, { actor, target, detail, reason, guildName }) {
  return String(template || "")
    .replaceAll("{actor}", actor ? `<@${actor.id}>` : "the system")
    .replaceAll("{target}", target ? `<@${target.id}>` : "")
    .replaceAll("{detail}", detail || "")
    .replaceAll("{reason}", reason || "No reason provided")
    .replaceAll("{server}", guildName || "");
}

/**
 * Whether this channel - or its category - is on the server's own
 * do-not-audit list. Only ever narrows what gets logged, never widens it.
 *
 * @param {import('discord.js').Guild} guild
 * @param {object|null} settings
 * @param {string} channelId
 * @returns {boolean}
 */
function isIgnoredChannel(guild, settings, channelId) {
  const ignored = settings?.event_router_ignored_channels;
  if (!ignored?.length) return false;
  if (ignored.includes(channelId)) return true;

  const channel = guild.channels.cache.get(channelId);
  return Boolean(channel?.parentId && ignored.includes(channel.parentId));
}

/**
 * Best-effort "who did this" for a gateway event that does not carry an
 * actor of its own (Discord's role/channel create and delete events do not
 * say who triggered them - only the audit log does).
 *
 * Missing `View Audit Log`, a rate limit, or anything else that goes wrong
 * here just means no actor is attributed - never a reason to fail the event
 * itself.
 *
 * @param {import('discord.js').Guild} guild
 * @param {{type: import('discord.js').AuditLogEvent, targetId?: string}} input
 * @returns {Promise<import('discord.js').User|null>}
 */
async function resolveAuditActor(guild, { type, targetId }) {
  try {
    const logs = await guild.fetchAuditLogs({ type, limit: 3 });
    const entry =
      (targetId && logs.entries.find((candidate) => candidate.target?.id === targetId)) || logs.entries.first();
    return entry?.executor || null;
  } catch {
    return null;
  }
}

/**
 * @param {import('discord.js').Guild} guild
 * @param {string} eventType one of EVENT_TYPES
 * @param {Object} [context]
 * @param {import('discord.js').User|import('discord.js').GuildMember} [context.actor] who caused it
 * @param {import('discord.js').User|import('discord.js').GuildMember} [context.target] who it happened to
 * @param {string} [context.detail] a name that isn't a mentionable Discord object - a role, a channel, a command
 * @param {string} [context.reason]
 * @param {string} [context.channelId] the channel the event happened in or is about, when there is one
 * @param {object} [context.logger] falls back to nothing rather than throwing when omitted
 * @param {Object} [dependencies] test seam; production code never passes this
 */
async function routeEvent(guild, eventType, context = {}, dependencies = {}) {
  if (!guild || !EVENT_TYPES.includes(eventType)) return;

  const { actor, target, detail, reason, channelId, logger } = context;
  const readSettings = dependencies.getSettings || getSettings;
  const writeLog = dependencies.createEventLog || createEventLog;

  const settings = await readSettings(guild).catch(() => null);
  if (channelId && isIgnoredChannel(guild, settings, channelId)) return;

  await writeLog({
    guild_id: guild.id,
    type: eventType,
    actor_id: actor?.id || null,
    target_id: target?.id || null,
    channel_id: channelId || null,
    detail: detail ? String(detail).slice(0, 300) : null,
    reason: reason ? String(reason).slice(0, 500) : null,
  }).catch((error) => logger?.error?.(`event router: could not log ${eventType} for ${guild.id}`, error));

  const route = settings?.event_router?.find((entry) => entry.event === eventType);
  if (!route?.enabled || !route.channel_id) return;

  // A channel the server deleted is not an error - the event still happened
  // and is already in the log above; there is simply nowhere left to post it.
  const channel = guild.channels.cache.get(route.channel_id);
  if (!channel?.isTextBased?.()) return;

  const text = renderEventTemplate(route.template || EVENT_DEFAULT_TEMPLATE[eventType], {
    actor,
    target,
    detail,
    reason,
    guildName: guild.name,
  });

  const mentionRoleId =
    route.mention_role_id && guild.roles.cache.has(route.mention_role_id) ? route.mention_role_id : null;
  const content = [mentionRoleId ? `<@&${mentionRoleId}>` : null, text]
    .filter(Boolean)
    .join(" ")
    .trim()
    .slice(0, MAX_CONTENT);
  if (!content) return;

  await channel
    .safeSend({
      content,
      allowedMentions: { roles: mentionRoleId ? [mentionRoleId] : [], users: target ? [target.id] : [], parse: [] },
    })
    .catch((error) => logger?.warn?.(`event router: could not post ${eventType} in ${channel.id}`, error));
}

module.exports = { renderEventTemplate, resolveAuditActor, routeEvent };
