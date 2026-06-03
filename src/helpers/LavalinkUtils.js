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
  loadTracks,
  normalizeLoadResult,
  toError,
  toQueueTrack,
};
