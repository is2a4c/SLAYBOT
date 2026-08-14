const crypto = require("node:crypto");

/**
 * What a custom command was doing between showing a form and its submission.
 *
 * `interaction.showModal()` answers the interaction that opened it; the
 * follow-up work — which command, which of its actions runs, what the command
 * was originally called with — has nowhere else to live, so it sits here under
 * a token short enough to fit in a component custom id.
 *
 * A session is read exactly once: the same token used twice (a stale client
 * resubmitting, or somebody trying to replay one) finds nothing the second
 * time, which is what keeps a submission from running its action twice.
 */

// A webhook token used to answer an interaction is only good for fifteen
// minutes; a session nobody returns to within that window is exactly as
// useless as the interaction it belongs to.
const TTL_MS = 15 * 60 * 1000;
const SWEEP_EVERY = 25;

/** @type {Map<string, {guildId: string, commandId: string, userId: string, args: string[], options: object, target: object|null, createdAt: number}>} */
const sessions = new Map();
let writes = 0;

function sweep() {
  const cutoff = Date.now() - TTL_MS;
  for (const [token, session] of sessions) {
    if (session.createdAt < cutoff) sessions.delete(token);
  }
}

module.exports = {
  TTL_MS,

  /**
   * @param {object} session everything the submission will need
   * @returns {string} the token to put in the modal's custom id
   */
  create(session) {
    const token = crypto.randomUUID();
    sessions.set(token, { ...session, createdAt: Date.now() });
    writes += 1;
    if (writes % SWEEP_EVERY === 0) sweep();
    return token;
  },

  /**
   * Read the session and remove it, whether or not it turns out to be usable —
   * a token is worth exactly one attempt.
   *
   * @param {string} token
   * @param {string} [userId] when given, a session opened for somebody else is
   *   refused rather than returned
   * @returns {object|null}
   */
  consume(token, userId) {
    const session = sessions.get(token);
    if (!session) return null;
    sessions.delete(token);

    if (Date.now() - session.createdAt > TTL_MS) return null;
    if (userId && session.userId !== userId) return null;
    return session;
  },

  /**
   * Give up on a session without ever letting it be consumed — used when
   * showing the modal itself failed, so the token it would have answered to is
   * never valid.
   *
   * @param {string} token
   */
  discard(token) {
    sessions.delete(token);
  },

  /**
   * Testing seam: the map is process-wide.
   */
  reset() {
    sessions.clear();
    writes = 0;
  },

  size: () => sessions.size,
};
