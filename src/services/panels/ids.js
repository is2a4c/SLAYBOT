/**
 * Ids shared between panels that would otherwise have to require each other.
 *
 * Every system panel keeps a way back to the hub, and the hub is what opens them,
 * so the id lives on its own rather than in either of them.
 */

const HUB_PREFIX = "PANELHUB";
const HOME_ID = `${HUB_PREFIX}:home`;

module.exports = { HOME_ID, HUB_PREFIX };
