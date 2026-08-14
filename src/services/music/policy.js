/**
 * A server's own rules for its music player: where it may be used, who may
 * control it, and where a plain query should search.
 *
 * Read here and nowhere else, so a prefix command, a slash command and the
 * command panel all answer to the same rules - and so the rule can only ever
 * narrow what Discord's own permissions already allow, never grant a member
 * control they would not otherwise have.
 */

const DEFAULT_MAX_QUEUE_PER_USER = 25;
const DEFAULT_MAX_TRACK_MINUTES = 180;

// A server-configured delay would need a fourteenth music setting nobody
// asked for; a fixed, generous window keeps a notice around long enough to
// read before "delete notices" clears it away.
const NOTICE_DELETE_SECONDS = 15;

// Lavalink's own search prefixes. Yandex and Spotify need the Lavalink node to
// carry the plugin that understands them - exactly like a Spotify URL already
// needs SPOTIFY_CLIENT_ID/SECRET to resolve. Missing support surfaces the same
// way any bad search does: no matches, not a crash.
const SOURCE_PREFIX = {
  YOUTUBE: "ytsearch",
  YOUTUBE_MUSIC: "ytmsearch",
  YANDEX: "ymsearch",
  SPOTIFY: "spsearch",
  SOUNDCLOUD: "scsearch",
};

// The static config's own source codes, from before a server could choose its
// own - honoured as the fallback when nothing has been configured yet.
const LEGACY_SOURCE = { YT: "YOUTUBE", YTM: "YOUTUBE_MUSIC", SC: "SOUNDCLOUD" };

// Commands that actually change what is playing or how - the ones a "DJ role"
// is there to gate. Browsing (`queue`, `np`, `search`, `lyric`) is never gated.
const CONTROL_COMMANDS = new Set(["skip", "stop", "volume", "seek", "loop", "shuffle", "pause", "resume", "bassboost"]);

/**
 * @param {object} settings guild settings document
 * @returns {object|null}
 */
function musicConfig(settings) {
  return settings?.control_center?.music || null;
}

/**
 * The Lavalink identifier to search with: the query verbatim when it is
 * already a URL, otherwise a source prefix in front of it.
 *
 * @param {string} query
 * @param {object} settings guild settings document
 * @param {string} [legacySource] `config.js`'s MUSIC.DEFAULT_SOURCE, used only
 *   when the server never chose its own
 * @returns {string}
 */
function searchIdentifier(query, settings, legacySource) {
  if (/^https?:\/\//i.test(query)) return query;

  const configured = musicConfig(settings)?.default_source;
  const source = (configured && SOURCE_PREFIX[configured] && configured) || LEGACY_SOURCE[legacySource] || "YOUTUBE";
  return `${SOURCE_PREFIX[source] || SOURCE_PREFIX.YOUTUBE}:${query}`;
}

/**
 * Why this server's music setup refuses this command, or null when it allows
 * it. Only ever asked about commands in the MUSIC category.
 *
 * @param {object} settings guild settings document
 * @param {object} command
 * @param {{member?: import('discord.js').GuildMember, channelId?: string}} where
 * @returns {string|null}
 */
function musicProblem(settings, command, { member, channelId } = {}) {
  if (command?.category !== "MUSIC") return null;

  const config = musicConfig(settings);
  if (!config) return null;

  if (config.channel_id && config.allow_any_channel === false && channelId && channelId !== config.channel_id) {
    return `Music commands can only be used in <#${config.channel_id}>`;
  }

  if (CONTROL_COMMANDS.has(command.name) && config.dj_roles?.length) {
    const holds = config.dj_roles.some((roleId) => Boolean(member?.roles?.cache?.has(roleId)));
    if (!holds) return "You need a DJ role to control the music player";
  }

  return null;
}

/**
 * Cap a freshly-loaded batch of tracks to what this server allows: nothing
 * over the length limit, and no more from one member than their share of the
 * queue.
 *
 * @param {object[]} tracks `{track, info}` entries, not yet queue-ready
 * @param {object} settings guild settings document
 * @param {Object} input
 * @param {object[]} [input.existingTracks] the queue's own tracks right now
 * @param {string} input.requesterName matches how a track's `requester` is stored
 * @returns {{tracks: object[], droppedForLength: number, droppedForQuota: number}}
 */
function applyQueueLimits(tracks, settings, { existingTracks = [], requesterName } = {}) {
  const config = musicConfig(settings);
  const maxTrackMs = (config?.max_track_minutes || DEFAULT_MAX_TRACK_MINUTES) * 60_000;
  const maxPerUser = config?.max_queue_per_user || DEFAULT_MAX_QUEUE_PER_USER;

  const withinLength = tracks.filter((entry) => (entry.info?.length || 0) <= maxTrackMs);
  const droppedForLength = tracks.length - withinLength.length;

  const alreadyQueued = existingTracks.filter((entry) => entry.requester === requesterName).length;
  const roomLeft = Math.max(0, maxPerUser - alreadyQueued);
  const kept = withinLength.slice(0, roomLeft);
  const droppedForQuota = withinLength.length - kept.length;

  return { tracks: kept, droppedForLength, droppedForQuota };
}

/**
 * How long a music command's own "added/played/skipped" reply should live
 * before deleting itself - this server's configured delay, or `undefined` to
 * leave it alone, which is exactly the shape `safeReply`/`safeSend`/
 * `safeFollowUp` already take as their own optional cleanup argument.
 *
 * @param {object} settings guild settings document
 * @returns {number|undefined}
 */
function noticeSeconds(settings) {
  return musicConfig(settings)?.delete_notices ? NOTICE_DELETE_SECONDS : undefined;
}

module.exports = {
  CONTROL_COMMANDS,
  DEFAULT_MAX_QUEUE_PER_USER,
  DEFAULT_MAX_TRACK_MINUTES,
  LEGACY_SOURCE,
  NOTICE_DELETE_SECONDS,
  SOURCE_PREFIX,
  applyQueueLimits,
  musicConfig,
  musicProblem,
  noticeSeconds,
  searchIdentifier,
};
