/**
 * The pure rules of a Forest Fuss round - who is a wolf, who a vote
 * eliminates, and who has won. Nothing here touches Discord or the database,
 * so the whole rulebook can be tested without either.
 */

/**
 * How many wolves a lobby of this size gets. Classic Werewolf ratio: about a
 * quarter of the table, never fewer than one.
 *
 * @param {number} playerCount
 * @returns {number}
 */
function wolfCount(playerCount) {
  return Math.max(1, Math.floor(playerCount / 4));
}

/**
 * @param {string[]} userIds
 * @param {() => number} [rng] injectable for deterministic tests
 * @returns {{user_id: string, role: "WOLF"|"VILLAGER", alive: true}[]}
 */
function assignRoles(userIds, rng = Math.random) {
  const shuffled = [...userIds];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  const wolves = new Set(shuffled.slice(0, wolfCount(userIds.length)));
  return userIds.map((userId) => ({ user_id: userId, role: wolves.has(userId) ? "WOLF" : "VILLAGER", alive: true }));
}

/**
 * The target with the most votes among the alive, or null on no votes or a
 * tie - a tie is nobody's mandate, so nobody is eliminated.
 *
 * @param {{voter_id: string, target_id: string}[]} votes
 * @param {Set<string>} aliveIds only votes for someone still alive count
 * @returns {string|null}
 */
function tally(votes, aliveIds) {
  const counts = new Map();
  for (const vote of votes) {
    if (!aliveIds.has(vote.target_id)) continue;
    counts.set(vote.target_id, (counts.get(vote.target_id) || 0) + 1);
  }
  if (counts.size === 0) return null;

  const ranked = [...counts.entries()].sort((left, right) => right[1] - left[1]);
  const [topId, topCount] = ranked[0];
  const tied = ranked.filter(([, count]) => count === topCount);
  return tied.length === 1 ? topId : null;
}

/**
 * @param {{role: "WOLF"|"VILLAGER", alive: boolean}[]} players
 * @returns {"WOLVES"|"VILLAGERS"|null} null while the game continues
 */
function checkWin(players) {
  const aliveWolves = players.filter((player) => player.alive && player.role === "WOLF").length;
  const aliveVillagers = players.filter((player) => player.alive && player.role === "VILLAGER").length;

  if (aliveWolves === 0) return "VILLAGERS";
  if (aliveWolves >= aliveVillagers) return "WOLVES";
  return null;
}

/**
 * Whether this member may force-skip the current phase or stop the game
 * outright - always the leader, and anyone else when the server did not
 * reserve the buttons for leaders alone.
 *
 * @param {{leader_id: string}} session
 * @param {string} userId
 * @param {boolean} leadersOnly
 * @returns {boolean}
 */
function canControl(session, userId, leadersOnly) {
  if (session.leader_id === userId) return true;
  if (leadersOnly) return false;
  return session.players.some((player) => player.user_id === userId && player.alive);
}

module.exports = {
  assignRoles,
  canControl,
  checkWin,
  tally,
  wolfCount,
};
