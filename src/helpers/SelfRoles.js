const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  parseEmoji,
} = require("discord.js");
const { parse: parseUnicodeEmoji } = require("twemoji-parser");
const { EMBED_COLORS } = require("@root/config");
const { MAX_PANEL_ROLES } = require("@schemas/SelfRolePanel");
const { applyBranding, resolveBranding } = require("@helpers/Branding");

const BUTTON_PREFIX = "SELFROLE";
const SELECT_PREFIX = "SELFROLE_SELECT";
const BUTTONS_PER_ROW = 5;

class SelfRoleError extends Error {
  constructor(message) {
    super(message);
    this.name = "SelfRoleError";
  }
}

/**
 * Accepts a unicode emoji or a custom emoji belonging to the guild and returns
 * the shape discord.js component builders expect.
 * @param {string} input
 * @param {import('discord.js').Guild} guild
 */
function resolveComponentEmoji(input, guild) {
  if (!input) return null;

  const custom = parseEmoji(input);
  if (custom?.id) {
    if (guild && !guild.emojis.cache.has(custom.id)) {
      throw new SelfRoleError(`Emoji ${input} does not belong to this server.`);
    }
    return input;
  }

  const parsed = parseUnicodeEmoji(input);
  if (parsed.length !== 1 || parsed[0].text !== input) {
    throw new SelfRoleError(`${input} is not a valid emoji.`);
  }
  return input;
}

/**
 * @param {object} panel
 * @param {{settings?: object, client?: import('discord.js').Client}} [context] guild branding
 */
function buildPanelEmbed(panel, { settings, client } = {}) {
  const embed = new EmbedBuilder()
    .setColor(panel.color || EMBED_COLORS.BOT_EMBED)
    .setTitle(panel.title || "Self roles");

  const lines = [];
  if (panel.description) lines.push(panel.description);

  if (panel.roles?.length) {
    lines.push(
      panel.roles.map((role) => `${role.emoji ? `${role.emoji} ` : ""}<@&${role.role_id}> — ${role.label}`).join("\n")
    );
  } else {
    lines.push("_No roles configured yet._");
  }

  const rules = [];
  if (panel.unique) rules.push("one role at a time");
  else if (panel.max_roles > 0) rules.push(`up to ${panel.max_roles} roles`);
  if (!panel.allow_remove) rules.push("roles cannot be removed here");
  if (panel.required_role) rules.push(`requires <@&${panel.required_role}>`);
  if (rules.length) lines.push(`\n-# ${rules.join(" · ")}`);

  embed.setDescription(lines.join("\n\n").slice(0, 4096));

  // A panel without its own colour follows the server's branding.
  if (!panel.color) applyBranding(embed, resolveBranding(settings, client), { force: true });
  return embed;
}

/**
 * @param {object} panel
 */
function buildPanelComponents(panel) {
  if (!panel.roles?.length) return [];

  if (panel.style === "SELECT") {
    const maxValues = panel.unique ? 1 : Math.min(panel.max_roles || panel.roles.length, panel.roles.length);
    const select = new StringSelectMenuBuilder()
      .setCustomId(`${SELECT_PREFIX}:${panel.message_id}`)
      .setPlaceholder((panel.placeholder || "Pick your roles").slice(0, 150))
      .setMinValues(0)
      .setMaxValues(Math.max(1, maxValues))
      .addOptions(
        panel.roles.map((role) => ({
          label: role.label.slice(0, 100),
          value: role.role_id,
          description: role.description ? role.description.slice(0, 100) : undefined,
          emoji: role.emoji || undefined,
        }))
      );

    return [new ActionRowBuilder().addComponents(select)];
  }

  const rows = [];
  for (let i = 0; i < panel.roles.length; i += BUTTONS_PER_ROW) {
    const row = new ActionRowBuilder().addComponents(
      panel.roles.slice(i, i + BUTTONS_PER_ROW).map((role) =>
        new ButtonBuilder()
          .setCustomId(`${BUTTON_PREFIX}:${panel.message_id}:${role.role_id}`)
          .setLabel(role.label.slice(0, 80))
          .setStyle(ButtonStyle.Secondary)
          .setEmoji(role.emoji || undefined)
      )
    );
    rows.push(row);
  }
  return rows;
}

/**
 * Decide which roles to add and remove for a panel interaction.
 *
 * Pure on purpose: every rule (toggle, unique, cap, add-only) is decided here so
 * button and select interactions cannot drift apart.
 *
 * @param {{panel: object, memberRoleIds: string[]|Set<string>, selected: string[]}} input
 * @returns {{add: string[], remove: string[], error: string|null}}
 */
function resolveRoleChanges({ panel, memberRoleIds, selected }) {
  const current = memberRoleIds instanceof Set ? memberRoleIds : new Set(memberRoleIds || []);
  const panelRoleIds = (panel.roles || []).map((role) => role.role_id);
  const panelRoleSet = new Set(panelRoleIds);

  const requested = (selected || []).filter((id) => panelRoleSet.has(id));
  if (requested.length !== (selected || []).length) {
    return { add: [], remove: [], error: "That role is no longer part of this panel." };
  }

  const held = panelRoleIds.filter((id) => current.has(id));

  // Button panels toggle a single role; select panels state the full desired set.
  if (panel.style !== "SELECT") {
    const roleId = requested[0];
    if (!roleId) return { add: [], remove: [], error: "That role is no longer part of this panel." };

    if (current.has(roleId)) {
      if (!panel.allow_remove) return { add: [], remove: [], error: "Roles from this panel cannot be removed." };
      return { add: [], remove: [roleId], error: null };
    }

    if (panel.unique) {
      return { add: [roleId], remove: held.filter((id) => id !== roleId), error: null };
    }

    if (panel.max_roles > 0 && held.length >= panel.max_roles) {
      return {
        add: [],
        remove: [],
        error: `You can only hold ${panel.max_roles} role${panel.max_roles === 1 ? "" : "s"} from this panel.`,
      };
    }

    return { add: [roleId], remove: [], error: null };
  }

  const desired = panel.unique ? requested.slice(0, 1) : requested;
  if (!panel.unique && panel.max_roles > 0 && desired.length > panel.max_roles) {
    return {
      add: [],
      remove: [],
      error: `You can only hold ${panel.max_roles} role${panel.max_roles === 1 ? "" : "s"} from this panel.`,
    };
  }

  const desiredSet = new Set(desired);
  const add = desired.filter((id) => !current.has(id));
  const remove = panel.allow_remove ? held.filter((id) => !desiredSet.has(id)) : [];

  return { add, remove, error: null };
}

/**
 * Roles the bot is actually able to hand out.
 * @param {import('discord.js').Guild} guild
 * @param {import('discord.js').Role} role
 */
function assertAssignable(guild, role) {
  if (!role) throw new SelfRoleError("That role no longer exists.");
  if (role.id === guild.id) throw new SelfRoleError("`@everyone` cannot be used as a self role.");
  if (role.managed) throw new SelfRoleError(`${role.name} is managed by an integration.`);
  if (!guild.members.me.permissions.has("ManageRoles"))
    throw new SelfRoleError("I need the `Manage Roles` permission.");
  if (guild.members.me.roles.highest.position <= role.position) {
    throw new SelfRoleError(`${role.name} is above my highest role, so I cannot assign it.`);
  }
  return role;
}

module.exports = {
  BUTTON_PREFIX,
  SELECT_PREFIX,
  MAX_PANEL_ROLES,
  SelfRoleError,
  assertAssignable,
  buildPanelComponents,
  buildPanelEmbed,
  resolveComponentEmoji,
  resolveRoleChanges,
};
