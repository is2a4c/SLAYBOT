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
const { redraw, warn } = require("./reply");

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

// One mark for everything that is off or unset, so a glance down the panel finds
// what still needs attention without reading a word of it.
const ON = "🟢";
const OFF = "⚪";

// Free text is a setting, not the message itself: a long welcome would push the
// rest of the panel out of the embed.
const PREVIEW = 60;

/**
 * Free text as one short line of code, safe to drop into the description.
 *
 * @param {*} value
 * @returns {string}
 */
function preview(value) {
  // Backticks would end the code span and let the rest of the value style the panel.
  const text = String(value).replace(/\s+/g, " ").replace(/`/g, "ʼ").trim();
  return `\`${text.length > PREVIEW ? `${text.slice(0, PREVIEW - 1)}…` : text}\``;
}

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
  const unset = `${OFF} ${t("common.notSet")}`;

  switch (field.type) {
    case "toggle":
      // Short, because the name beside it already says what is being switched.
      return value ? `${ON} ${t("common.on")}` : `${OFF} ${t("common.off")}`;
    case "channel":
      return value ? `<#${value}>` : unset;
    case "role":
      return value ? `<@&${value}>` : unset;
    case "roleList":
      return value?.length ? value.map((id) => `<@&${id}>`).join(", ") : `${OFF} ${t("common.none")}`;
    case "channelList":
      return value?.length ? value.map((id) => `<#${id}>`).join(", ") : `${OFF} ${t("common.none")}`;
    case "choice":
      return value ? preview(t(`${field.choicesKey}.${value}`)) : unset;
    case "number":
      // Where zero is a value the field accepts, it means "do not apply this at
      // all" — a limit of zero lines is not a limit of zero.
      if (value === 0) return field.min === 0 ? `${OFF} ${t("common.off")}` : "`0`";
      return value ? `\`${value}\`` : unset;
    default:
      return value === 0 || value ? preview(value) : unset;
  }
}

/**
 * The colour a field's button is drawn in.
 *
 * The panel is read as a map before it is read as a list: green is on or about to
 * do something, blue is a channel or role already chosen, grey is everything
 * still untouched.
 *
 * @param {object} field
 * @param {*} value
 * @returns {number} discord.js ButtonStyle
 */
function buttonStyle(field, value) {
  if (field.type === "toggle") return value ? ButtonStyle.Success : ButtonStyle.Secondary;

  // Fields that also do something once stored — posting the public panel — are the
  // one call to action on the screen.
  if (field.type === "action" || field.after) return ButtonStyle.Success;

  if (field.type === "channel" || field.type === "role" || field.type === "roleList" || field.type === "channelList") {
    const filled = Array.isArray(value) ? value.length > 0 : Boolean(value);
    return filled ? ButtonStyle.Primary : ButtonStyle.Secondary;
  }

  return field.style ?? ButtonStyle.Secondary;
}

/**
 * @param {Object} definition
 * @param {string} definition.id custom id namespace
 * @param {string} definition.titleKey
 * @param {string} [definition.icon] emoji shown before the title
 * @param {string} definition.descriptionKey
 * @param {string} definition.actionsKey translation prefix for the field names
 * @param {string} [definition.hintKey]
 * @param {string} definition.path where the settings live, e.g. "ticket"
 * @param {object[][]} definition.rows fields laid out as they appear
 * @param {string} [definition.homeId] custom id of a "back to the menu" button kept
 *   on every render, so the way out survives a redraw
 */
function defineConfigPanel({ id, titleKey, icon, descriptionKey, actionsKey, hintKey, path, rows, homeId }) {
  const fields = rows.flat();
  const byId = new Map(fields.map((field) => [field.id, field]));

  const panel = definePanel({
    id,
    titleKey,
    icon,
    descriptionKey,
    actionsKey,
    hintKey,
    rows: rows.map((row) => row.map(({ id: fieldId, emoji, style }) => ({ id: fieldId, emoji, style }))),
  });

  // A panel usually sits under one settings key; "" lets one gather loose settings.
  const fieldPath = (field) => (field.key ? (path ? `${path}.${field.key}` : field.key) : null);

  /**
   * What every setting currently is, keyed by the button that changes it.
   *
   * @param {(key: string, vars?: object) => string} t
   * @param {object} settings guild settings document
   * @returns {Record<string, string>}
   */
  function values(t, settings) {
    return Object.fromEntries(
      fields
        .filter((field) => field.type !== "action")
        .map((field) => [field.id, formatValue(field, readPath(settings, fieldPath(field)), t)])
    );
  }

  /**
   * @param {object} settings guild settings document
   * @returns {Record<string, number>} button style per field
   */
  function styles(settings) {
    return Object.fromEntries(
      fields.map((field) => [
        field.id,
        buttonStyle(field, field.type === "action" ? null : readPath(settings, fieldPath(field))),
      ])
    );
  }

  /**
   * The way back to the hub, kept on every render so it survives a redraw.
   *
   * @param {(key: string, vars?: object) => string} t
   * @param {ButtonBuilder[]} [before] buttons sharing the row, drawn first
   * @returns {ActionRowBuilder[]}
   */
  function homeRow(t, before = []) {
    if (!homeId) return before.length ? [new ActionRowBuilder().addComponents(before)] : [];

    return [
      new ActionRowBuilder().addComponents([
        ...before,
        new ButtonBuilder()
          .setCustomId(homeId)
          .setEmoji("🏠")
          .setLabel(t("common.menu"))
          .setStyle(ButtonStyle.Secondary),
      ]),
    ];
  }

  /**
   * @param {(key: string, vars?: object) => string} t
   * @param {object} settings guild settings document
   * @param {import('discord.js').Client} [client]
   */
  function build(t, settings, client) {
    const base = panel.build(t, { settings, client, values: values(t, settings), styles: styles(settings) });
    return { embeds: base.embeds, components: [...base.components, ...homeRow(t)] };
  }

  /**
   * The same panel with one picker open in place of the buttons.
   *
   * The menu opens on what is already stored, the way a modal opens on the text it
   * is replacing, and picking nothing clears the setting.
   *
   * @param {(key: string, vars?: object) => string} t
   * @param {object} settings guild settings document
   * @param {object} field
   * @param {{client?: import('discord.js').Client, guild?: import('discord.js').Guild}} [context]
   */
  function buildPicker(t, settings, field, { client, guild } = {}) {
    const base = panel.build(t, {
      settings,
      client,
      values: values(t, settings),
      styles: styles(settings),
      focus: field.id,
    });

    const customId = panel.selectId(field.id);
    const placeholder = t(`${actionsKey}.${field.id}`).slice(0, 150);
    const current = readPath(settings, fieldPath(field));
    const list = field.type === "roleList" || field.type === "channelList";
    // Discord rejects the whole menu over a default pointing at something the
    // guild no longer has, so a deleted channel or role is quietly dropped.
    const alive = (cache) => [current || []].flat().filter((id) => id && cache?.get?.(id));

    let menu;
    if (field.type === "channel" || field.type === "channelList") {
      const chosen = alive(guild?.channels?.cache);
      menu = new ChannelSelectMenuBuilder()
        .setCustomId(customId)
        .setPlaceholder(placeholder)
        .setChannelTypes(field.channelTypes || [ChannelType.GuildText])
        .setMinValues(0)
        .setMaxValues(list ? field.max || 10 : 1);
      if (chosen.length) menu.setDefaultChannels(chosen);
    } else if (field.type === "role" || field.type === "roleList") {
      const chosen = alive(guild?.roles?.cache);
      menu = new RoleSelectMenuBuilder()
        .setCustomId(customId)
        .setPlaceholder(placeholder)
        .setMinValues(0)
        .setMaxValues(list ? field.max || 10 : 1);
      if (chosen.length) menu.setDefaultRoles(chosen);
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

    const back = new ButtonBuilder()
      .setCustomId(panel.buttonId(BACK))
      .setEmoji("↩️")
      .setLabel(t("common.back"))
      .setStyle(ButtonStyle.Secondary);

    return {
      embeds: base.embeds,
      components: [new ActionRowBuilder().addComponents(menu), ...homeRow(t, [back])],
    };
  }

  /**
   * @param {object} field
   * @param {(key: string, vars?: object) => string} t
   * @param {*} current
   */
  function buildModal(field, t, current) {
    const label = t(`${actionsKey}.${field.id}`).slice(0, 45);
    // A range reaching below zero needs room for the sign: -12 is three characters
    // even though 14 is two.
    const digits = Math.max(String(field.min ?? 0).length, String(field.max ?? 99).length);
    const input = new TextInputBuilder()
      .setCustomId("value")
      .setLabel(label)
      .setStyle(field.long ? TextInputStyle.Paragraph : TextInputStyle.Short)
      .setRequired(field.required !== false)
      .setMaxLength(field.type === "number" ? digits : field.maxLength || 200);

    // What a good answer looks like, so nobody has to guess and be told no.
    const hint =
      field.type === "number" ? t("panels.common.range", { min: field.min ?? 0, max: field.max ?? 99 }) : field.example;
    if (hint) input.setPlaceholder(String(hint).slice(0, 100));

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
    const draw = () => redraw(interaction, build(t, settings, interaction.client));

    /**
     * Redraw and store at the same time. The panel already holds the new value,
     * so a click does not have to wait for the database to acknowledge the write
     * before it shows anything.
     *
     * @param {object} field
     */
    async function store(field) {
      const saving = settings.save().catch((error) => {
        interaction.client?.logger?.error("panel: failed to save settings", error);
      });

      await draw();
      await saving;
      // Some settings do something once stored, such as posting a public panel.
      await field.after?.(interaction, settings, t);
    }

    if (parsed.action === BACK) {
      await draw();
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
        await store(field);
        return true;
      }

      if (field.type === "text" || field.type === "number") {
        await interaction.showModal(buildModal(field, t, readPath(settings, fieldPath(field))));
        return true;
      }

      await redraw(
        interaction,
        buildPicker(t, settings, field, { client: interaction.client, guild: interaction.guild })
      );
      return true;
    }

    if (parsed.kind === "select") {
      const values = interaction.values || [];

      if (field.type === "roleList" || field.type === "channelList") writePath(settings, fieldPath(field), values);
      else writePath(settings, fieldPath(field), values[0] ?? null);

      await store(field);
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
        await warn(interaction, t("common.numberRange", { min, max }));
        return true;
      }
      value = parsedNumber;
    } else if (raw.length === 0) {
      value = null;
    }

    // Free text that something downstream has to parse — a colour, a URL — is
    // checked here, because storing it unchecked breaks the feature at the point
    // it is used rather than at the point it is set.
    if (value !== null && field.validate) {
      const checked = field.validate(value);
      if (!checked.ok) {
        await warn(interaction, t(checked.reason));
        return true;
      }
      value = checked.value ?? value;
    }

    writePath(settings, fieldPath(field), value);

    if (interaction.isFromMessage()) {
      await store(field);
      return true;
    }

    await settings.save();
    await field.after?.(interaction, settings, t);
    await warn(interaction, t("common.saved"));

    return true;
  }

  return {
    build,
    buildPicker,
    fields,
    // Where each field ends up in the guild document, so the wiring can be checked.
    fieldPath,
    handle,
    matches: panel.matches,
    panel,
    path,
    styles,
    values,
  };
}

module.exports = { BACK, OFF, ON, buttonStyle, defineConfigPanel, formatValue, preview, readPath, writePath };
