/**
 * A server's own rules for Forest Fuss - read here and nowhere else, so the
 * command, the interaction handler and the scheduler all agree on the same
 * settings.
 */

// Below this many players a wolf/villager split stops being a real game -
// the schema's own max_players floor (4) is the same number, so this just
// makes that floor apply to the low end too, where nothing else enforces it.
const MIN_PLAYERS = 4;

/**
 * @param {object} settings guild settings document
 * @returns {object|null}
 */
function funConfig(settings) {
  return settings?.control_center?.fun || null;
}

/**
 * @param {object} settings
 * @returns {boolean}
 */
function forestFussEnabled(settings) {
  return Boolean(funConfig(settings)?.forest_fuss_enabled);
}

/**
 * @param {object} settings
 * @returns {string|null}
 */
function categoryId(settings) {
  return funConfig(settings)?.category_id || null;
}

/**
 * @param {object} settings
 * @returns {number}
 */
function maxSessions(settings) {
  const value = Number(funConfig(settings)?.max_sessions);
  return Number.isFinite(value) && value > 0 ? value : 1;
}

/**
 * @param {object} settings
 * @returns {number}
 */
function maxPlayers(settings) {
  const value = Number(funConfig(settings)?.max_players);
  return Number.isFinite(value) && value >= MIN_PLAYERS ? value : 20;
}

/**
 * @param {object} settings
 * @returns {string}
 */
function lobbyName(settings) {
  return funConfig(settings)?.lobby_name || "forest-lobby";
}

/**
 * @param {object} settings
 * @returns {string}
 */
function wolvesName(settings) {
  return funConfig(settings)?.wolves_name || "wolves";
}

/**
 * @param {object} settings
 * @returns {boolean} whether only the leader may skip a phase or stop the game
 */
function leadersOnly(settings) {
  return funConfig(settings)?.leaders_only !== false;
}

/**
 * @param {object} settings
 * @param {"recruitment"|"day"|"night"|"result"} phase
 * @returns {number} seconds
 */
function phaseSeconds(settings, phase) {
  const defaults = { recruitment: 120, day: 180, night: 120, result: 30 };
  const value = Number(funConfig(settings)?.[`${phase}_seconds`]);
  return Number.isFinite(value) && value > 0 ? value : defaults[phase];
}

module.exports = {
  MIN_PLAYERS,
  categoryId,
  forestFussEnabled,
  funConfig,
  leadersOnly,
  lobbyName,
  maxPlayers,
  maxSessions,
  phaseSeconds,
  wolvesName,
};
