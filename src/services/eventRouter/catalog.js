/**
 * The events a server can route to a channel of its own.
 *
 * Member join/leave and boosts already have their own dedicated, richer
 * setup (welcome, farewell, the boost notification) and stay out of this
 * catalogue on purpose. Everything else that used to have nowhere to go -
 * individual moderation actions instead of one shared modlog channel, plus
 * server, message, voice, command and subscription events - lives here.
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
  "MESSAGE_DELETE",
  "MESSAGE_EDIT",
  "VOICE_JOIN",
  "VOICE_LEAVE",
  "VOICE_MOVE",
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
  MESSAGE_DELETE: "messages",
  MESSAGE_EDIT: "messages",
  VOICE_JOIN: "voice",
  VOICE_LEAVE: "voice",
  VOICE_MOVE: "voice",
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
  MESSAGE_DELETE: "🗑️ A message by {actor} was deleted: {detail}",
  MESSAGE_EDIT: "📝 {actor} edited a message: {detail}",
  VOICE_JOIN: "🔊 {actor} joined voice channel **{detail}**.",
  VOICE_LEAVE: "🔈 {actor} left voice channel **{detail}**.",
  VOICE_MOVE: "🔀 {actor} moved voice channels: {detail}",
  COMMAND_BLOCKED: "🚫 {actor} was blocked from running `{detail}`. Reason: {reason}",
  SUBSCRIPTION_PAUSED: "⏸️ The subscription **{detail}** was paused after repeated errors. Last error: {reason}",
};

module.exports = { EVENT_DEFAULT_TEMPLATE, EVENT_GROUPS, EVENT_TYPES };
