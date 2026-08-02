/**
 * What somebody has filled in on a command form, between one click and the next.
 *
 * A custom id has a hundred characters to work with, which is nowhere near a
 * filled-in form, so the values live here and the id only says which form they
 * belong to. Nothing here is worth keeping: a draft that is abandoned — or lost
 * to a restart — costs the person retyping one form, and the panel opens on an
 * empty one rather than on something stale.
 */

const TTL_MS = 15 * 60 * 1000;
const SWEEP_EVERY = 50;

/** @type {Map<string, {values: object, touchedAt: number}>} */
const drafts = new Map();
let writes = 0;

/**
 * @param {string} userId
 * @param {string} path command path, e.g. "ticket add"
 */
function keyFor(userId, path) {
  return `${userId}|${path}`;
}

/**
 * Drop everything nobody came back to. Called on writes rather than on a timer,
 * so an idle bot is not woken up to tidy an empty map.
 */
function sweep() {
  const cutoff = Date.now() - TTL_MS;
  for (const [key, draft] of drafts) {
    if (draft.touchedAt < cutoff) drafts.delete(key);
  }
}

module.exports = {
  TTL_MS,

  /**
   * @param {string} userId
   * @param {string} path
   * @returns {object} the values filled in so far, empty when there are none
   */
  read(userId, path) {
    const draft = drafts.get(keyFor(userId, path));
    if (!draft) return {};
    if (Date.now() - draft.touchedAt > TTL_MS) {
      drafts.delete(keyFor(userId, path));
      return {};
    }

    return draft.values;
  },

  /**
   * @param {string} userId
   * @param {string} path
   * @param {string} option
   * @param {*} value null clears it
   */
  write(userId, path, option, value) {
    const key = keyFor(userId, path);
    const draft = drafts.get(key) || { values: {}, touchedAt: Date.now() };

    if (value === null || value === undefined || value === "") delete draft.values[option];
    else draft.values[option] = value;

    draft.touchedAt = Date.now();
    drafts.set(key, draft);

    writes += 1;
    if (writes % SWEEP_EVERY === 0) sweep();

    return draft.values;
  },

  /**
   * @param {string} userId
   * @param {string} path
   */
  clear(userId, path) {
    drafts.delete(keyFor(userId, path));
  },

  /**
   * Testing seam: the map is process-wide, so a test that fills a form can put it
   * back the way it found it.
   */
  reset() {
    drafts.clear();
    writes = 0;
  },

  size: () => drafts.size,
};
