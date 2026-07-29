const { parseEmoji } = require("discord.js");
const { parse: parseUnicodeEmoji } = require("twemoji-parser");

const MAX_REACTION_ROLES = 20;
const ROLE_REFERENCE = "(?:<@&([0-9]{17,20})>|([0-9]{17,20}))";

class ReactionRoleMappingError extends Error {
  constructor(message) {
    super(message);
    this.name = "ReactionRoleMappingError";
  }
}

/**
 * Parse a bulk reaction-role list.
 *
 * Supported entries:
 * 😀 = @Role
 * 😀 @Role
 *
 * Entries can be separated by a comma, pipe, semicolon, or new line.
 *
 * @param {string} input
 * @returns {{ reaction: string, roleId: string }[]}
 */
function parseReactionRoleMappings(input) {
  const entries = String(input || "")
    .split(/[\n,|;]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (entries.length === 0) {
    throw new ReactionRoleMappingError("Provide at least one emoji and role pair.");
  }
  if (entries.length > MAX_REACTION_ROLES) {
    throw new ReactionRoleMappingError(`A message can have at most ${MAX_REACTION_ROLES} reaction roles.`);
  }

  return entries.map((entry, index) => {
    const explicit = entry.match(new RegExp(`^(.+?)\\s*(?:=|->)\\s*${ROLE_REFERENCE}$`));
    const compact = entry.match(new RegExp(`^(\\S+)\\s+${ROLE_REFERENCE}$`));
    const match = explicit || compact;

    if (!match) {
      throw new ReactionRoleMappingError(
        `Pair ${index + 1} is invalid. Use \`emoji @role\` and separate pairs with commas.`
      );
    }

    const reaction = match[1].trim();
    const roleId = match[2] || match[3];
    return { reaction, roleId };
  });
}

/**
 * Convert a custom or unicode emoji into the value stored by reaction roles.
 *
 * @param {string} reaction
 * @param {import("discord.js").Guild} guild
 * @returns {string}
 */
function normalizeReactionEmoji(reaction, guild) {
  const custom = parseEmoji(reaction);
  if (custom.id) {
    if (!guild.emojis.cache.has(custom.id)) {
      throw new ReactionRoleMappingError(`Emoji ${reaction} does not belong to this server.`);
    }
    return custom.id;
  }

  const parsed = parseUnicodeEmoji(reaction);
  if (parsed.length !== 1 || parsed[0].text !== reaction) {
    throw new ReactionRoleMappingError(`${reaction} is not a valid emoji.`);
  }
  return reaction;
}

module.exports = {
  MAX_REACTION_ROLES,
  ReactionRoleMappingError,
  normalizeReactionEmoji,
  parseReactionRoleMappings,
};
