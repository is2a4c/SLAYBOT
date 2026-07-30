const { getSettings } = require("@schemas/Guild");
const { logAudit } = require("./auditLog");

function getPath(target, path) {
  return path.split(".").reduce((value, key) => value?.[key], target);
}

function setPath(target, path, value) {
  const parts = path.split(".");
  const last = parts.pop();
  const parent = parts.reduce((current, key) => {
    if (current[key] === undefined || current[key] === null) current[key] = {};
    return current[key];
  }, target);
  parent[last] = value;
}

/**
 * Applies a flat `{ "automod.anti_links": true, "welcome.enabled": false }`
 * style patch to a guild's settings document and persists it.
 *
 * Reuses the exact convention already used by admin slash-commands
 * (`getSettings(guild)` returns the same object instance held in the in-memory
 * FixedSizeMap cache; mutating it and calling `.save()` keeps the live bot
 * config and the dashboard in sync without any separate cache-invalidation step).
 *
 * @param {import('discord.js').Guild} guild
 * @param {Record<string, unknown>} patch
 * @param {{id: string, tag: string, action: string, reason?: string}} actor
 */
async function applyGuildConfigPatch(guild, patch, actor) {
  const settings = await getSettings(guild);
  const before = {};
  const after = {};

  for (const [path, value] of Object.entries(patch)) {
    before[path] = getPath(settings, path);
    setPath(settings, path, value);
    after[path] = value;
  }

  await settings.save();

  await logAudit({
    actorId: actor.id,
    actorTag: actor.tag,
    action: actor.action,
    guildId: guild.id,
    targetType: "guild_config",
    targetId: guild.id,
    before,
    after,
    reason: actor.reason || null,
  });

  return settings;
}

module.exports = { applyGuildConfigPatch, getPath, setPath };
