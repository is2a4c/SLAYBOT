/**
 * A server's own rules for the roulette command, plus the one roll that
 * decides it - kept separate from the command file so the odds can be tested
 * without touching Discord at all.
 */

const CHAMBERS = 6;
const TIMEOUT_MS = 5 * 60 * 1000;

/**
 * @param {object} settings guild settings document
 * @returns {boolean}
 */
function rouletteEnabled(settings) {
  return Boolean(settings?.control_center?.fun?.roulette_enabled);
}

/**
 * One pull of the trigger. True means the chamber was loaded.
 *
 * @param {() => number} [rng] injectable for deterministic tests, same
 *   contract as Math.random - [0, 1)
 * @returns {boolean}
 */
function spinsChamber(rng = Math.random) {
  return Math.floor(rng() * CHAMBERS) === 0;
}

module.exports = {
  CHAMBERS,
  TIMEOUT_MS,
  rouletteEnabled,
  spinsChamber,
};
