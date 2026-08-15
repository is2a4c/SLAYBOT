/**
 * The events a server can route to a channel of its own.
 *
 * Member join/leave and boosts already have their own dedicated, richer
 * setup (welcome, farewell, the boost notification) - this catalogue is
 * everything that had no channel of its own before: individual moderation
 * actions instead of one shared modlog channel, and three kinds of event
 * nothing surfaced anywhere at all.
 *
 * A no-dependency module on purpose: the guild schema needs the id list for
 * its own enum, and importing anything schema-adjacent back into schema code
 * is how a require cycle starts.
 */

const EVENT_TYPES = [
  "WARN",
  "TIMEOUT",
  "KICK",
  "BAN",
  "ROLE_CREATE",
  "ROLE_DELETE",
  "CHANNEL_CREATE",
  "CHANNEL_DELETE",
  "COMMAND_BLOCKED",
  "SUBSCRIPTION_PAUSED",
];

const EVENT_GROUPS = {
  WARN: "moderation",
  TIMEOUT: "moderation",
  KICK: "moderation",
  BAN: "moderation",
  ROLE_CREATE: "server",
  ROLE_DELETE: "server",
  CHANNEL_CREATE: "server",
  CHANNEL_DELETE: "server",
  COMMAND_BLOCKED: "commands",
  SUBSCRIPTION_PAUSED: "subscriptions",
};

// What a route falls back to when the server never wrote its own template.
// Every one of these uses only the variables `renderEventTemplate` fills in.
const EVENT_DEFAULT_TEMPLATE = {
  WARN: "⚠️ {target} was warned by {actor}. Reason: {reason}",
  TIMEOUT: "🔇 {target} was timed out by {actor}. Reason: {reason}",
  KICK: "👢 {target} was kicked by {actor}. Reason: {reason}",
  BAN: "🔨 {target} was banned by {actor}. Reason: {reason}",
  ROLE_CREATE: "➕ Role **{detail}** was created by {actor}.",
  ROLE_DELETE: "➖ Role **{detail}** was deleted by {actor}.",
  CHANNEL_CREATE: "➕ Channel **{detail}** was created by {actor}.",
  CHANNEL_DELETE: "➖ Channel **{detail}** was deleted by {actor}.",
  COMMAND_BLOCKED: "🚫 {actor} was blocked from running `{detail}`. Reason: {reason}",
  SUBSCRIPTION_PAUSED: "⏸️ The subscription **{detail}** was paused after repeated errors. Last error: {reason}",
};

module.exports = { EVENT_DEFAULT_TEMPLATE, EVENT_GROUPS, EVENT_TYPES };
