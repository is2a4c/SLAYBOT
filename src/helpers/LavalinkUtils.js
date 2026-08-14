/**
 * Whether at least one Lavalink node is actually reachable right now.
 *
 * `client.musicManager` existing only means the feature is turned on; a node
 * can still be offline, in which case every connect attempt would fail one at
 * a time before finally giving up. Checked up front so that failure is
 * reported once, clearly, instead of after a string of retries.
 *
 * @param {object} manager
 * @returns {boolean}
 */
function hasAvailableNode(manager) {
  return [...(manager?.nodes?.values?.() || [])].some((node) => node?.ws?.active);
}

async function loadTracks(manager, identifier) {
  if (manager.api?.loadTracks) return manager.api.loadTracks(identifier);
  if (manager.rest?.loadTracks) return manager.rest.loadTracks(identifier);
  throw new Error("Lavalink manager does not expose loadTracks");
}

function normalizeLoadResult(res) {
  switch (res.loadType) {
    case "track":
      return { loadType: "TRACK_LOADED", tracks: [res.data] };
    case "playlist":
      return { loadType: "PLAYLIST_LOADED", tracks: res.data.tracks, playlistInfo: res.data.info };
    case "search":
      return { loadType: "SEARCH_RESULT", tracks: res.data };
    case "empty":
      return { loadType: "NO_MATCHES", tracks: [] };
    case "error":
      return {
        loadType: "LOAD_FAILED",
        tracks: [],
        exception: {
          message: [res.data?.message, res.data?.cause].filter(Boolean).join(": "),
        },
      };
    default:
      return res;
  }
}

function toQueueTrack(track) {
  if (!track?.encoded) return track;
  return {
    track: track.encoded,
    info: track.info,
  };
}

function toError(error) {
  if (error instanceof Error) return error;
  if (typeof error === "string") return new Error(error);

  try {
    return new Error(JSON.stringify(error));
  } catch {
    return new Error(String(error));
  }
}

module.exports = {
  hasAvailableNode,
  loadTracks,
  normalizeLoadResult,
  toError,
  toQueueTrack,
};
