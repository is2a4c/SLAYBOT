const { EVENT_DEFAULT_TEMPLATE, EVENT_GROUPS, EVENT_TYPES } = require("@src/services/eventRouter/catalog");

/**
 * Turning the event router's whole-form submission into the stored route
 * list, and the stored route list back into what the form shows.
 *
 * One row per event type, always every one of them - a route nobody has
 * touched yet is simply everything off, same as before this page existed.
 */

const SNOWFLAKE = /^\d{17,20}$/;

function channelMatches(entry) {
  return Boolean(entry?.isTextBased?.() && !entry.isThread?.());
}

/**
 * The ignored-channels list accepts any channel type, including whole
 * categories - unlike a route's destination, which must be somewhere the
 * bot can actually post.
 *
 * @param {import('discord.js').Guild} guild
 * @param {string|string[]} raw
 * @returns {string[]}
 */
function buildIgnoredChannels(guild, raw) {
  const values = Array.isArray(raw) ? raw : String(raw || "").split(",");
  return [
    ...new Set(
      values
        .flatMap((value) => String(value ?? "").split(","))
        .map((value) => value.trim())
        .filter((id) => SNOWFLAKE.test(id) && guild.channels.cache.has(id))
    ),
  ].slice(0, 50);
}

/**
 * @param {import('discord.js').Guild} guild
 * @param {object} body form fields, named `<field>_<EVENT>`
 * @returns {object[]} the full, ten-entry route list
 */
function buildRoutes(guild, body) {
  return EVENT_TYPES.map((event) => {
    const channelId = String(body[`channel_${event}`] || "");
    const channel = SNOWFLAKE.test(channelId) ? guild.channels.cache.get(channelId) : null;
    const roleId = String(body[`mention_${event}`] || "");
    const template =
      String(body[`template_${event}`] || "")
        .trim()
        .slice(0, 1000) || null;

    return {
      event,
      enabled: body[`enabled_${event}`] === "on",
      channel_id: channelMatches(channel) ? channel.id : null,
      template,
      mention_role_id: SNOWFLAKE.test(roleId) && guild.roles.cache.has(roleId) ? roleId : null,
    };
  });
}

/**
 * @param {object} settings guild settings document
 * @returns {{group: string, event: string, enabled: boolean, channel_id: string|null, template: string|null, mention_role_id: string|null, placeholder: string}[]}
 */
function routesForView(settings) {
  const stored = new Map((settings.event_router || []).map((route) => [route.event, route]));

  return EVENT_TYPES.map((event) => {
    const route = stored.get(event);
    return {
      event,
      group: EVENT_GROUPS[event],
      enabled: Boolean(route?.enabled),
      channel_id: route?.channel_id || null,
      template: route?.template || "",
      mention_role_id: route?.mention_role_id || null,
      placeholder: EVENT_DEFAULT_TEMPLATE[event],
    };
  });
}

module.exports = { buildIgnoredChannels, buildRoutes, routesForView };
