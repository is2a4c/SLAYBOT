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
  UserSelectMenuBuilder,
} = require("discord.js");

/**
 * Asking for one value at a time, the same way everywhere.
 *
 * Settings panels, command forms and the list panels all show the same thing: a
 * line naming what a value is and what it currently is, and a button that changes
 * it. Only where the value is kept differs, so the drawing and the asking live
 * here and the panels bring their own storage.
 *
 * A field is:
 *   {id, name|nameKey, emoji, type, required?, choices?, choiceLabels?, min?, max?,
 *    maxLength?, long?, example?, channelTypes?, validate?}
 *
 * Types: text, number, toggle, choice, channel, role, user, roleList, channelList.
 */

// Off or unset; a required field still waiting is louder than an optional one.
const OFF = "⚪";
const MISSING = "⚠️";
const ON = "🟢";
const PREVIEW = 60;

// Discord takes at most this much in one modal box.
const MAX_TEXT = 4000;
// Room for the largest whole number counted exactly, and its sign.
const UNBOUNDED_DIGITS = 16;

const ICONS = {
  text: "📝",
  number: "🔢",
  toggle: "🔘",
  choice: "📋",
  channel: "#️⃣",
  role: "🎭",
  roleList: "🎭",
  channelList: "#️⃣",
  user: "👤",
};

/** Field types that hold several values rather than one. */
const LISTS = new Set(["roleList", "channelList"]);

/**
 * @param {string} text
 * @param {number} limit
 */
function fit(text, limit) {
  const clean = String(text).replaceAll("\n", " ").trim();
  return clean.length > limit ? `${clean.slice(0, limit - 1)}…` : clean;
}

/**
 * Free text as one short code span, safe to drop into a description.
 *
 * @param {*} value
 */
function preview(value) {
  // A backtick inside the value would end the span and style the rest of the panel.
  return `\`${fit(String(value).replaceAll("`", "ʼ"), PREVIEW)}\``;
}

/**
 * @param {object} field
 * @param {(key: string, vars?: object) => string} t
 * @returns {string}
 */
function label(field, t) {
  return field.nameKey ? t(field.nameKey) : field.name || field.id;
}

/**
 * @param {object} field
 * @param {*} value
 * @param {(key: string, vars?: object) => string} t
 * @returns {string}
 */
function formatValue(field, value, t) {
  const empty = value === null || value === undefined || value === "" || (LISTS.has(field.type) && !value.length);

  if (empty) {
    if (field.type === "toggle") return `${OFF} ${t("common.off")}`;
    return field.required ? `${MISSING} ${t("common.needed")}` : `${OFF} ${t("common.notSet")}`;
  }

  switch (field.type) {
    case "roleList":
      return value.map((id) => `<@&${id}>`).join(", ");
    case "channelList":
      return value.map((id) => `<#${id}>`).join(", ");
    case "toggle":
      return value ? `${ON} ${t("common.on")}` : `${OFF} ${t("common.off")}`;
    case "channel":
      return `<#${value}>`;
    case "role":
      return `<@&${value}>`;
    case "user":
      return `<@${value}>`;
    case "choice":
      return `\`${fit(field.choiceLabels?.[value] || value, PREVIEW)}\``;
    case "number":
      return `\`${value}\``;
    default:
      return preview(value);
  }
}

/**
 * The colour of a field's button: green for on, blue for chosen, red for a
 * required answer still missing, grey for the rest.
 *
 * @param {object} field
 * @param {*} value
 * @returns {number} discord.js ButtonStyle
 */
function buttonStyle(field, value) {
  const filled = value !== null && value !== undefined && value !== "" && (!LISTS.has(field.type) || value.length > 0);

  if (field.type === "toggle") return value ? ButtonStyle.Success : ButtonStyle.Secondary;
  if (!filled) return field.required ? ButtonStyle.Danger : ButtonStyle.Secondary;
  if (field.type === "channel" || field.type === "role" || field.type === "user") return ButtonStyle.Primary;

  return ButtonStyle.Primary;
}

/**
 * One line per field, in the order of the buttons below them.
 *
 * @param {(key: string, vars?: object) => string} t
 * @param {object[]} fields
 * @param {object} values
 * @param {{focus?: string}} [view] the field a picker is currently open for
 * @returns {string[]}
 */
function lines(t, fields, values, { focus = null } = {}) {
  return fields.map((field) => {
    const name = field.id === focus ? `__${label(field, t)}__` : label(field, t);
    return `${field.emoji || ICONS[field.type] || "▫️"} **${name}:** ${formatValue(field, values[field.id] ?? null, t)}`;
  });
}

/**
 * The buttons, five to a row.
 *
 * @param {(key: string, vars?: object) => string} t
 * @param {object[]} fields
 * @param {object} values
 * @param {(field: object) => string} customId
 * @param {{rows?: number}} [limits]
 * @returns {ActionRowBuilder[]}
 */
function rows(t, fields, values, customId, { rows: maxRows = 4 } = {}) {
  const built = [];

  for (let index = 0; index < fields.length && built.length < maxRows; index += 5) {
    built.push(
      new ActionRowBuilder().addComponents(
        fields.slice(index, index + 5).map((field) =>
          new ButtonBuilder()
            .setCustomId(customId(field))
            .setEmoji(field.emoji || ICONS[field.type] || "▫️")
            .setLabel(fit(label(field, t), 40))
            .setStyle(buttonStyle(field, values[field.id] ?? null))
        )
      )
    );
  }

  return built;
}

/**
 * The picker for a field that is chosen rather than typed.
 *
 * It opens on what is already stored, and picking nothing clears it.
 *
 * @param {object} field
 * @param {*} current
 * @param {{customId: string, placeholder: string, guild?: import('discord.js').Guild}} context
 */
function select(field, current, { customId, placeholder, guild }) {
  const list = LISTS.has(field.type);
  // Discord rejects the whole menu over a default pointing at something the guild
  // no longer has, so a deleted channel or role is quietly dropped.
  const alive = (cache) => [current || []].flat().filter((id) => id && cache?.get?.(id));
  const most = list ? field.max || 10 : 1;

  if (field.type === "channel" || field.type === "channelList") {
    const menu = new ChannelSelectMenuBuilder()
      .setCustomId(customId)
      .setPlaceholder(fit(placeholder, 100))
      .setChannelTypes(field.channelTypes?.length ? field.channelTypes : [ChannelType.GuildText])
      .setMinValues(field.required && !list ? 1 : 0)
      .setMaxValues(most);

    const chosen = alive(guild?.channels?.cache);
    if (chosen.length) menu.setDefaultChannels(chosen);
    return menu;
  }

  if (field.type === "role" || field.type === "roleList") {
    const menu = new RoleSelectMenuBuilder()
      .setCustomId(customId)
      .setPlaceholder(fit(placeholder, 100))
      .setMinValues(field.required && !list ? 1 : 0)
      .setMaxValues(most);

    const chosen = alive(guild?.roles?.cache);
    if (chosen.length) menu.setDefaultRoles(chosen);
    return menu;
  }

  if (field.type === "user") {
    const menu = new UserSelectMenuBuilder()
      .setCustomId(customId)
      .setPlaceholder(fit(placeholder, 100))
      .setMinValues(field.required ? 1 : 0)
      .setMaxValues(1);

    if (current) menu.setDefaultUsers([current]);
    return menu;
  }

  return new StringSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder(fit(placeholder, 100))
    .addOptions(
      (field.choices || []).slice(0, 25).map((choice) => ({
        value: choice,
        label: fit(field.choiceLabels?.[choice] || choice, 100),
        default: choice === current,
      }))
    );
}

/**
 * The dialog for a field that is typed.
 *
 * @param {object} field
 * @param {*} current
 * @param {{customId: string, t: (key: string, vars?: object) => string}} context
 */
function modal(field, current, { customId, t }) {
  const name = fit(label(field, t), 45);
  // A field that names no range still has to take a number somebody can type, so
  // the box is sized to the largest whole number JavaScript counts exactly, sign
  // included. A range reaching below zero needs room for the sign too.
  const bounds = [field.min, field.max].filter((value) => value !== null && value !== undefined);
  const digits = bounds.length ? Math.max(...bounds.map((value) => String(value).length)) : UNBOUNDED_DIGITS;

  const input = new TextInputBuilder()
    .setCustomId("value")
    .setLabel(name)
    .setStyle(field.long ? TextInputStyle.Paragraph : TextInputStyle.Short)
    .setRequired(false)
    // Without a declared length the only limit is the modal's own.
    .setMaxLength(field.type === "number" ? Math.max(digits, 2) : Math.min(field.maxLength || MAX_TEXT, MAX_TEXT));

  // What a good answer looks like, so nobody has to guess and be told no. A range
  // is only worth quoting when the field has one on both ends.
  const hint =
    field.type === "number" && bounds.length === 2
      ? t("panels.common.range", { min: field.min, max: field.max })
      : field.example || (field.descriptionKey ? t(field.descriptionKey) : null);
  if (hint) input.setPlaceholder(fit(hint, 100));

  if (current !== null && current !== undefined && current !== "") input.setValue(String(current).slice(0, 4000));

  return new ModalBuilder()
    .setCustomId(customId)
    .setTitle(name)
    .addComponents(new ActionRowBuilder().addComponents(input));
}

/**
 * What somebody typed, as the field's own kind of value.
 *
 * @param {object} field
 * @param {string} raw
 * @returns {{ok: boolean, value?: *, reason?: string}}
 */
function parseInput(field, raw) {
  const text = String(raw ?? "").trim();
  if (text === "") return { ok: true, value: null };

  if (field.type === "number") {
    if (!/^-?\d+$/.test(text)) return { ok: false, reason: "common.numberRange" };
    const parsed = Number.parseInt(text, 10);
    // A field is held to the range it declares, and to nothing when it declares none.
    if (field.min !== null && field.min !== undefined && parsed < field.min) {
      return { ok: false, reason: "common.numberRange" };
    }
    if (field.max !== null && field.max !== undefined && parsed > field.max) {
      return { ok: false, reason: "common.numberRange" };
    }
    return { ok: true, value: parsed };
  }

  if (field.validate) return field.validate(text);

  return { ok: true, value: text };
}

/**
 * @param {object[]} fields
 * @param {object} values
 * @returns {object[]} the fields still standing between here and saving
 */
function missing(fields, values) {
  return fields.filter((field) => {
    if (!field.required) return false;
    const value = values[field.id];
    return value === undefined || value === null || (LISTS.has(field.type) && !value.length);
  });
}

module.exports = {
  ICONS,
  LISTS,
  MISSING,
  OFF,
  ON,
  buttonStyle,
  fit,
  formatValue,
  label,
  lines,
  missing,
  modal,
  parseInput,
  preview,
  rows,
  select,
};
