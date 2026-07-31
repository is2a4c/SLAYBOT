const {
  ActionRowBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
} = require("discord.js");
const { EMBED_COLORS } = require("@root/config");
const { applyBranding, resolveBranding } = require("@helpers/Branding");
const { guildTranslator, interactionTranslator } = require("@src/i18n");
const { normalizeAutoRoles } = require("@handlers/memberRoles");

const PREFIX = "AUTOROLE";
const ADD = `${PREFIX}:add`;
const REMOVE = `${PREFIX}:remove`;

// Matches the cap the dashboard and the settings panel apply.
const MAX_AUTOROLES = 10;

/**
 * Work out which roles a pick actually changes, and why the rest were refused.
 *
 * Pure, so the merge rules are testable without a guild: a role already on the
 * list is not added twice, roles the bot cannot hand out are named back to the
 * admin, and the cap is honoured.
 *
 * @param {{current: string[], picked: string[], giveable?: (id: string) => boolean, max?: number}} input
 * @returns {{next: string[], added: string[], already: string[], refused: string[], overflow: string[]}}
 */
function mergeAutoRoles({ current, picked, giveable = () => true, max = MAX_AUTOROLES }) {
  const next = normalizeAutoRoles(current);
  const added = [];
  const already = [];
  const refused = [];
  const overflow = [];

  for (const id of picked) {
    if (next.includes(id)) {
      already.push(id);
      continue;
    }
    if (!giveable(id)) {
      refused.push(id);
      continue;
    }
    if (next.length >= max) {
      overflow.push(id);
      continue;
    }

    next.push(id);
    added.push(id);
  }

  return { next, added, already, refused, overflow };
}

/**
 * @param {{current: string[], picked: string[]}} input
 * @returns {{next: string[], removed: string[], missing: string[]}}
 */
function removeAutoRoles({ current, picked }) {
  const existing = normalizeAutoRoles(current);
  const removed = picked.filter((id) => existing.includes(id));
  const missing = picked.filter((id) => !existing.includes(id));

  return { next: existing.filter((id) => !picked.includes(id)), removed, missing };
}

/**
 * Why a role cannot be given out, or null when it can.
 *
 * @param {import('discord.js').Guild} guild
 * @param {string} roleId
 * @returns {"missing"|"everyone"|"managed"|"tooHigh"|null}
 */
function roleProblem(guild, roleId) {
  const role = guild.roles.cache.get(roleId);
  if (!role) return "missing";
  if (role.id === guild.id) return "everyone";
  if (role.managed) return "managed";
  if (guild.members.me.roles.highest.position <= role.position) return "tooHigh";
  return null;
}

/**
 * @param {(key: string, vars?: object) => string} t
 * @param {object} settings guild settings document
 * @param {import('discord.js').Guild} guild
 */
function statusEmbed(t, settings, guild) {
  const current = normalizeAutoRoles(settings.autorole);

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLORS.BOT_EMBED)
    .setTitle(t("autorole.title"))
    .setDescription(
      current.length
        ? t("autorole.current", { roles: current.map((id) => `<@&${id}>`).join(", ") })
        : t("autorole.empty")
    );

  applyBranding(embed, resolveBranding(settings, guild?.client), { force: true });
  return embed;
}

module.exports = {
  ADD,
  MAX_AUTOROLES,
  PREFIX,
  REMOVE,
  mergeAutoRoles,
  removeAutoRoles,
  statusEmbed,

  /**
   * @param {string} customId
   * @returns {boolean}
   */
  matches(customId) {
    return String(customId).startsWith(`${PREFIX}:`);
  },

  /**
   * The "which roles?" picker. Several at once, chosen from the role list rather
   * than typed in.
   *
   * @param {(key: string, vars?: object) => string} t
   * @param {object} settings guild settings document
   * @param {import('discord.js').Guild} guild
   */
  buildAddMenu(t, settings, guild) {
    const room = Math.max(1, MAX_AUTOROLES - normalizeAutoRoles(settings.autorole).length);

    return {
      embeds: [statusEmbed(t, settings, guild)],
      components: [
        new ActionRowBuilder().addComponents(
          new RoleSelectMenuBuilder()
            .setCustomId(ADD)
            .setPlaceholder(t("autorole.pickAdd").slice(0, 150))
            .setMinValues(1)
            .setMaxValues(Math.min(room, 25))
        ),
      ],
    };
  },

  /**
   * Removal picks from the roles actually configured, so nothing else can be
   * chosen by mistake.
   *
   * @param {(key: string, vars?: object) => string} t
   * @param {object} settings guild settings document
   * @param {import('discord.js').Guild} guild
   */
  buildRemoveMenu(t, settings, guild) {
    const current = normalizeAutoRoles(settings.autorole);
    if (!current.length) return { content: t("autorole.empty") };

    const options = current.slice(0, 25).map((id) => ({
      value: id,
      label: (guild.roles.cache.get(id)?.name || id).slice(0, 100),
    }));

    return {
      embeds: [statusEmbed(t, settings, guild)],
      components: [
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(REMOVE)
            .setPlaceholder(t("autorole.pickRemove").slice(0, 150))
            .setMinValues(1)
            .setMaxValues(options.length)
            .addOptions(options)
        ),
      ],
    };
  },

  /**
   * @param {import('discord.js').AnySelectMenuInteraction} interaction
   * @param {object} settings guild settings document
   * @returns {Promise<boolean>} whether the interaction belonged here
   */
  async handleSelect(interaction, settings) {
    if (!this.matches(interaction.customId)) return false;

    const t = interactionTranslator(interaction, settings);
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply({ content: t("panels.common.forbidden"), ephemeral: true });
      return true;
    }

    await interaction.deferUpdate();
    const picked = interaction.values || [];
    const lines = [];

    if (interaction.customId === ADD) {
      const result = mergeAutoRoles({
        current: settings.autorole,
        picked,
        giveable: (id) => roleProblem(interaction.guild, id) === null,
      });

      settings.autorole = result.next;
      await settings.save();

      if (result.added.length) lines.push(t("autorole.added", { roles: mentions(result.added) }));
      if (result.already.length) lines.push(t("autorole.already", { roles: mentions(result.already) }));
      if (result.overflow.length) lines.push(t("autorole.overflow", { max: MAX_AUTOROLES }));
      for (const id of result.refused) {
        lines.push(t(`autorole.refused.${roleProblem(interaction.guild, id) || "missing"}`, { role: `<@&${id}>` }));
      }
    } else {
      const result = removeAutoRoles({ current: settings.autorole, picked });

      settings.autorole = result.next;
      await settings.save();

      if (result.removed.length) lines.push(t("autorole.removed", { roles: mentions(result.removed) }));
      if (!result.next.length) lines.push(t("autorole.nowEmpty"));
    }

    await interaction.editReply({
      content: lines.join("\n"),
      embeds: [statusEmbed(guildTranslator(settings, interaction.guild), settings, interaction.guild)],
      components: [],
    });

    return true;
  },
};

/**
 * @param {string[]} ids
 * @returns {string}
 */
function mentions(ids) {
  return ids.map((id) => `<@&${id}>`).join(", ");
}
