/**
 * Per-server policy for the bot's own commands.
 *
 * A server can switch a command or a whole category off, keep it to a set of
 * roles or channels, and give it a cooldown of its own. The rules are read here
 * and nowhere else, so a prefix message, a slash command and a panel button all
 * answer to the same policy — a button cannot become a way around a rule the
 * slash command enforces.
 *
 * The policy only ever takes access away. It never grants a command to somebody
 * Discord's own permissions would refuse, so nothing here can be used to hand a
 * member a moderation command they could not run anyway.
 */

const MAX_COOLDOWN_SECONDS = 86400;
const MAX_POLICY_IDS = 25;
const MAX_COMMAND_NAME = 32;

/**
 * The stored policy for one command, or null when the server never touched it.
 *
 * @param {object} settings guild settings document
 * @param {string} commandName
 * @returns {object|null}
 */
function commandPolicy(settings, commandName) {
  if (!commandName) return null;
  return (settings?.command_policy?.commands || []).find((entry) => entry.name === commandName) || null;
}

/**
 * @param {object} settings guild settings document
 * @param {string} category
 * @returns {boolean} true when the whole category is switched off
 */
function categoryDisabled(settings, category) {
  if (!category) return false;
  return (settings?.command_policy?.disabled_categories || []).includes(category);
}

/**
 * How long this member has to wait between uses of this command.
 *
 * A server override of `0` is a deliberate "no cooldown" and is honoured; only
 * an absent override falls back to what the command itself declares.
 *
 * @param {object} settings guild settings document
 * @param {object} command
 * @returns {number} seconds
 */
function effectiveCooldown(settings, command) {
  const override = commandPolicy(settings, command?.name)?.cooldown_seconds;
  if (override === null || override === undefined) return Number(command?.cooldown || 0);
  const parsed = Number(override);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.min(parsed, MAX_COOLDOWN_SECONDS) : 0;
}

/**
 * A channel satisfies an allow-list when it is on it, or when its category is.
 *
 * @param {string[]} allowed
 * @param {{channelId?: string, parentId?: string}} where
 * @returns {boolean}
 */
function channelAllowed(allowed, { channelId, parentId }) {
  if (!allowed?.length) return true;
  return allowed.includes(channelId) || (Boolean(parentId) && allowed.includes(parentId));
}

/**
 * Why this server's policy refuses this command, or null when it allows it.
 *
 * @param {object} settings guild settings document
 * @param {object} command
 * @param {Object} where
 * @param {import('discord.js').GuildMember} [where.member]
 * @param {string} [where.channelId]
 * @param {string} [where.parentId] the channel's category, when it has one
 * @param {"prefix"|"slash"|"panel"} [where.source]
 * @returns {string|null}
 */
function policyProblem(settings, command, { member, channelId, parentId, source } = {}) {
  if (!command) return null;

  if (source === "prefix" && settings?.control_center?.common?.text_commands === false) {
    return "Text commands are disabled on this server";
  }

  if (source === "slash" && settings?.control_center?.common?.slash_commands === false) {
    return "Slash commands are disabled on this server";
  }

  if (categoryDisabled(settings, command.category)) {
    return "This command group is disabled on this server";
  }

  const policy = commandPolicy(settings, command.name);
  if (!policy) return null;

  if (policy.enabled === false) return "This command is disabled on this server";

  if (!channelAllowed(policy.allowed_channels, { channelId, parentId })) {
    return "This command is not available in this channel";
  }

  // A member object is what proves a role. Without one there is nothing to
  // check against, and an allow-list that cannot be satisfied refuses.
  if (policy.allowed_roles?.length) {
    const holds = policy.allowed_roles.some((roleId) => Boolean(member?.roles?.cache?.has(roleId)));
    if (!holds) return "You do not have a role allowed to use this command";
  }

  return null;
}

/**
 * Keep only what the schema accepts, so a hand-made request cannot store a
 * cooldown of a year or a thousand role ids.
 *
 * @param {object} entry
 * @param {(id: string) => boolean} roleExists
 * @param {(id: string) => boolean} channelExists
 * @returns {object|null} null when there is no usable command name
 */
function sanitizeCommandPolicy(entry, { roleExists = () => true, channelExists = () => true } = {}) {
  const name = String(entry?.name || "")
    .trim()
    .toLowerCase()
    .slice(0, MAX_COMMAND_NAME);
  if (!name) return null;

  const ids = (values, exists) => [
    ...new Set(
      (Array.isArray(values) ? values : [values])
        .flatMap((value) => String(value ?? "").split(","))
        .map((value) => value.trim())
        .filter((value) => /^\d{17,20}$/.test(value) && exists(value))
    ),
  ];

  const rawCooldown = entry?.cooldown_seconds;
  let cooldown = null;
  if (rawCooldown !== null && rawCooldown !== undefined && String(rawCooldown).trim() !== "") {
    const parsed = Number.parseInt(String(rawCooldown), 10);
    if (Number.isFinite(parsed)) cooldown = Math.min(MAX_COOLDOWN_SECONDS, Math.max(0, parsed));
  }

  return {
    name,
    enabled: entry?.enabled !== false,
    cooldown_seconds: cooldown,
    allowed_roles: ids(entry?.allowed_roles || [], roleExists).slice(0, MAX_POLICY_IDS),
    allowed_channels: ids(entry?.allowed_channels || [], channelExists).slice(0, MAX_POLICY_IDS),
  };
}

/**
 * A command left at its defaults stores nothing, so the list stays as short as
 * what the server actually changed.
 *
 * @param {object} entry sanitised policy
 * @returns {boolean}
 */
function isDefaultPolicy(entry) {
  return (
    entry.enabled !== false &&
    entry.cooldown_seconds === null &&
    entry.allowed_roles.length === 0 &&
    entry.allowed_channels.length === 0
  );
}

/**
 * The stored list with one command's policy replaced, dropping it again when it
 * says nothing the defaults do not already say.
 *
 * @param {object[]} current
 * @param {object} next sanitised policy
 * @returns {object[]}
 */
function upsertCommandPolicy(current, next) {
  const policies = (current || [])
    .filter((entry) => entry?.name && entry.name !== next.name)
    .map((entry) => ({
      name: entry.name,
      enabled: entry.enabled !== false,
      cooldown_seconds: entry.cooldown_seconds ?? null,
      allowed_roles: [...(entry.allowed_roles || [])],
      allowed_channels: [...(entry.allowed_channels || [])],
    }));

  if (!isDefaultPolicy(next)) policies.push(next);
  return policies.sort((left, right) => left.name.localeCompare(right.name, "en"));
}

/**
 * The categories a server switched off, limited to ones that exist.
 *
 * @param {string[]|string} raw
 * @param {string[]} known category ids the bot actually has
 * @returns {string[]}
 */
function sanitizeDisabledCategories(raw, known) {
  const allowed = new Set(known);
  return [
    ...new Set(
      (Array.isArray(raw) ? raw : [raw])
        .map((value) =>
          String(value ?? "")
            .trim()
            .toUpperCase()
        )
        .filter((value) => allowed.has(value))
    ),
  ].sort();
}

module.exports = {
  MAX_COOLDOWN_SECONDS,
  MAX_POLICY_IDS,
  categoryDisabled,
  channelAllowed,
  commandPolicy,
  effectiveCooldown,
  isDefaultPolicy,
  policyProblem,
  sanitizeCommandPolicy,
  sanitizeDisabledCategories,
  upsertCommandPolicy,
};
