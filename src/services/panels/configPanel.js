const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  ModalBuilder,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");
const { definePanel } = require("./definePanel");

/**
 * A settings screen made of icon buttons.
 *
 * Each system declares which settings it has and what kind they are; everything
 * else — drawing the current state, asking for a value, storing it and redrawing —
 * is shared. Pickers replace the buttons inside the same message rather than
 * spawning follow-ups, so a whole system is configured without leaving the panel.
 *
 * Field types:
 *   toggle       flip a boolean
 *   text         short free text, asked for in a modal
 *   number       whole number in a range, asked for in a modal
 *   channel      one channel, picked from a channel menu
 *   role         one role, picked from a role menu
 *   roleList     several roles at once
 *   channelList  several channels at once
 *   choice       one of a fixed set of values
 *   action       runs the field's own `run()` instead of storing anything
 */

const BACK = "__back";

/**
 * @param {object} target
 * @param {string} path dotted
 */
function readPath(target, path) {
  return path.split(".").reduce((value, key) => value?.[key], target);
}

/**
 * @param {object} target
 * @param {string} path dotted
 * @param {*} value
 */
function writePath(target, path, value) {
  const parts = path.split(".");
  const last = parts.pop();
  const parent = parts.reduce((current, key) => current?.[key], target);
  if (parent) parent[last] = value;
}

/**
 * @param {object} field
 * @param {*} value
 * @param {(key: string, vars?: object) => string} t
 * @returns {string}
 */
function formatValue(field, value, t) {
  switch (field.type) {
    case "toggle":
      return value ? t("common.enabled") : t("common.disabled");
    case "channel":
      return value ? `<#${value}>` : t("common.notSet");
    case "role":
      return value ? `<@&${value}>` : t("common.notSet");
    case "roleList":
      return value?.length ? value.map((id) => `<@&${id}>`).join(", ") : t("common.none");
    case "channelList":
      return value?.length ? value.map((id) => `<#${id}>`).join(", ") : t("common.none");
    case "choice":
      return value ? t(`${field.choicesKey}.${value}`) : t("common.notSet");
    default:
      return value === 0 || value ? `\`${value}\`` : t("common.notSet");
  }
}

/**
 * @param {Object} definition
 * @param {string} definition.id custom id namespace
 * @param {string} definition.titleKey
 * @param {string} definition.descriptionKey
 * @param {string} definition.actionsKey translation prefix for the field names
 * @param {string} [definition.hintKey]
 * @param {string} definition.path where the settings live, e.g. "ticket"
 * @param {object[][]} definition.rows fields laid out as they appear
 * @param {string} [definition.homeId] custom id of a "back to the menu" button kept
 *   on every render, so the way out survives a redraw
 */
function defineConfigPanel({ id, titleKey, descriptionKey, actionsKey, hintKey, path, rows, homeId }) {
  const fields = rows.flat();
  const byId = new Map(fields.map((field) => [field.id, field]));

  const panel = definePanel({
    id,
    titleKey,
    descriptionKey,
    actionsKey,
    hintKey,
    rows: rows.map((row) => row.map(({ id: fieldId, emoji, style }) => ({ id: fieldId, emoji, style }))),
  });

  // A panel usually sits under one settings key; "" lets one gather loose settings.
  const fieldPath = (field) => (field.key ? (path ? `${path}.${field.key}` : field.key) : null);

  /**
   * The "**Name:** value" lines above the legend.
   *
   * @param {(key: string, vars?: object) => string} t
   * @param {object} settings guild settings document
   * @returns {string[]}
   */
  function statusLines(t, settings) {
    return fields
      .filter((field) => field.type !== "action")
      .map((field) => {
        const value = formatValue(field, readPath(settings, fieldPath(field)), t);
        return `**${t(`${actionsKey}.${field.id}`)}:** ${value}`;
      });
  }

  /**
   * @param {(key: string, vars?: object) => string} t
   * @returns {ActionRowBuilder[]}
   */
  function homeRow(t) {
    if (!homeId) return [];

    return [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(homeId)
          .setEmoji("🏠")
          .setLabel(t("common.menu"))
          .setStyle(ButtonStyle.Secondary)
      ),
    ];
  }

  /**
   * @param {(key: string, vars?: object) => string} t
   * @param {object} settings guild settings document
   * @param {import('discord.js').Client} [client]
   */
  function build(t, settings, client) {
    const base = panel.build(t, { settings, client, status: statusLines(t, settings) });
    return { embeds: base.embeds, components: [...base.components, ...homeRow(t)] };
  }

  /**
   * The same panel with one picker open in place of the buttons.
   *
   * @param {(key: string, vars?: object) => string} t
   * @param {object} settings guild settings document
   * @param {object} field
   * @param {import('discord.js').Client} [client]
   */
  function buildPicker(t, settings, field, client) {
    const base = panel.build(t, { settings, client, status: statusLines(t, settings) });
    const customId = panel.selectId(field.id);
    const placeholder = t(`${actionsKey}.${field.id}`).slice(0, 150);
    const current = readPath(settings, fieldPath(field));

    let menu;
    if (field.type === "channel" || field.type === "channelList") {
      menu = new ChannelSelectMenuBuilder()
        .setCustomId(customId)
        .setPlaceholder(placeholder)
        .setChannelTypes(field.channelTypes || [ChannelType.GuildText]);
      if (field.type === "channelList") menu.setMinValues(0).setMaxValues(field.max || 10);
    } else if (field.type === "role" || field.type === "roleList") {
      menu = new RoleSelectMenuBuilder().setCustomId(customId).setPlaceholder(placeholder);
      if (field.type === "roleList") menu.setMinValues(0).setMaxValues(field.max || 10);
    } else {
      menu = new StringSelectMenuBuilder()
        .setCustomId(customId)
        .setPlaceholder(placeholder)
        .addOptions(
          field.choices.map((choice) => ({
            value: choice,
            label: t(`${field.choicesKey}.${choice}`).slice(0, 100),
            default: choice === current,
          }))
        );
    }

    return {
      embeds: base.embeds,
      components: [
        new ActionRowBuilder().addComponents(menu),
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(panel.buttonId(BACK))
            .setEmoji("↩️")
            .setLabel(t("common.back"))
            .setStyle(ButtonStyle.Secondary)
        ),
        ...homeRow(t),
      ],
    };
  }

  /**
   * @param {object} field
   * @param {(key: string, vars?: object) => string} t
   * @param {*} current
   */
  function buildModal(field, t, current) {
    const label = t(`${actionsKey}.${field.id}`).slice(0, 45);
    const input = new TextInputBuilder()
      .setCustomId("value")
      .setLabel(label)
      .setStyle(field.long ? TextInputStyle.Paragraph : TextInputStyle.Short)
      .setRequired(field.required !== false)
      .setMaxLength(field.type === "number" ? String(field.max ?? 99).length : field.maxLength || 200);

    if (current !== undefined && current !== null && current !== "") input.setValue(String(current).slice(0, 4000));

    return new ModalBuilder()
      .setCustomId(panel.modalId(field.id))
      .setTitle(label)
      .addComponents(new ActionRowBuilder().addComponents(input));
  }

  /**
   * Drive one interaction that belongs to this panel.
   *
   * @param {import('discord.js').Interaction} interaction
   * @param {object} settings guild settings document
   * @param {(key: string, vars?: object) => string} t
   * @returns {Promise<boolean>} whether the interaction belonged here
   */
  async function handle(interaction, settings, t) {
    if (!panel.matches(interaction.customId)) return false;

    const parsed = panel.parse(interaction.customId);
    const redraw = () => interaction.update(build(t, settings, interaction.client));

    if (parsed.action === BACK) {
      await redraw();
      return true;
    }

    const field = byId.get(parsed.action);
    if (!field) return true;

    // Buttons either act at once, open a picker in place, or open a modal.
    if (parsed.kind === "button") {
      if (field.type === "action") {
        await field.run(interaction, settings, t);
        return true;
      }

      if (field.type === "toggle") {
        writePath(settings, fieldPath(field), !readPath(settings, fieldPath(field)));
        await settings.save();
        await field.after?.(interaction, settings, t);
        await redraw();
        return true;
      }

      if (field.type === "text" || field.type === "number") {
        await interaction.showModal(buildModal(field, t, readPath(settings, fieldPath(field))));
        return true;
      }

      await interaction.update(buildPicker(t, settings, field, interaction.client));
      return true;
    }

    if (parsed.kind === "select") {
      const values = interaction.values || [];

      if (field.type === "roleList" || field.type === "channelList") writePath(settings, fieldPath(field), values);
      else writePath(settings, fieldPath(field), values[0] ?? null);

      await settings.save();
      // Some settings do something once they are stored, such as posting a panel.
      await field.after?.(interaction, settings, t);
      await redraw();
      return true;
    }

    // Modal submit: validate, store, and redraw the panel it was opened from.
    const raw = interaction.fields.getTextInputValue("value").trim();
    let value = raw;

    if (field.type === "number") {
      const parsedNumber = Number.parseInt(raw, 10);
      const min = field.min ?? 0;
      const max = field.max ?? 99;

      if (!/^-?\d+$/.test(raw) || parsedNumber < min || parsedNumber > max) {
        await interaction.reply({ content: t("common.numberRange", { min, max }), ephemeral: true });
        return true;
      }
      value = parsedNumber;
    } else if (raw.length === 0) {
      value = null;
    }

    writePath(settings, fieldPath(field), value);
    await settings.save();
    await field.after?.(interaction, settings, t);

    if (interaction.isFromMessage()) await redraw();
    else await interaction.reply({ content: t("common.saved"), ephemeral: true });

    return true;
  }

  return {
    build,
    buildPicker,
    fields,
    handle,
    matches: panel.matches,
    panel,
    statusLines,
  };
}

module.exports = { BACK, defineConfigPanel, formatValue, readPath, writePath };
