const { ActionRowBuilder, ButtonBuilder, EmbedBuilder } = require("discord.js");
const { EMBED_COLORS } = require("@root/config");
const { applyBranding, resolveBranding } = require("@helpers/Branding");

/**
 * Every control surface in the bot is the same shape: an embed naming what the
 * icons do — with what each one is currently set to, where there is something to
 * show — and rows of icon buttons underneath. This builds one from a declaration
 * so the systems stay consistent and only differ in their actions.
 *
 * Custom ids are namespaced per panel:
 *   `TICKET:close`            a button
 *   `TICKET~SEL:staff:<ref>`  a select menu the panel opened
 *   `TICKET~MOD:name:<ref>`   a modal the panel opened
 *
 * `<ref>` is whatever the panel needs to find its subject again — a channel id,
 * a message id, an empty string when the guild settings are enough.
 */

const SELECT_MARK = "~SEL";
const MODAL_MARK = "~MOD";

// Discord refuses an embed longer than this, and refusing it at send time would
// lose the whole panel rather than the tail of one setting.
const MAX_TITLE = 256;
const MAX_DESCRIPTION = 4096;

/**
 * @param {string} text
 * @param {number} limit
 */
function fit(text, limit) {
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

/**
 * @typedef {Object} PanelAction
 * @property {string} id action name, also the translation key under `actionsKey`
 * @property {string} emoji icon shown on the button and in the legend
 * @property {number} style discord.js ButtonStyle
 */

/**
 * @param {Object} definition
 * @param {string} definition.id custom id namespace, uppercase
 * @param {string} definition.titleKey
 * @param {string} [definition.icon] emoji shown before the title
 * @param {string} definition.descriptionKey
 * @param {string} definition.actionsKey translation prefix for the action names
 * @param {string} [definition.hintKey] closing line under the legend
 * @param {PanelAction[][]} definition.rows up to five rows of up to five actions
 */
function definePanel({ id, titleKey, icon, descriptionKey, actionsKey, hintKey, rows }) {
  const actions = rows.flat();
  const actionIds = actions.map((action) => action.id);
  const byId = new Map(actions.map((action) => [action.id, action]));

  const buttonId = (action) => `${id}:${action}`;
  const selectId = (action, ref = "") => `${id}${SELECT_MARK}:${action}:${ref}`;
  const modalId = (action, ref = "") => `${id}${MODAL_MARK}:${action}:${ref}`;

  const matchesButton = (customId) => String(customId).startsWith(`${id}:`);
  const matchesSelect = (customId) => String(customId).startsWith(`${id}${SELECT_MARK}:`);
  const matchesModal = (customId) => String(customId).startsWith(`${id}${MODAL_MARK}:`);
  const matches = (customId) => matchesButton(customId) || matchesSelect(customId) || matchesModal(customId);

  /**
   * Split a custom id back into what it addresses.
   *
   * @param {string} customId
   * @returns {{kind: "button"|"select"|"modal", action: string, ref: string}|null}
   */
  function parse(customId) {
    const text = String(customId);

    if (matchesButton(text)) return { kind: "button", action: text.slice(id.length + 1), ref: "" };

    const kind = matchesSelect(text) ? "select" : matchesModal(text) ? "modal" : null;
    if (!kind) return null;

    const mark = kind === "select" ? SELECT_MARK : MODAL_MARK;
    const [action, ...rest] = text.slice(id.length + mark.length + 1).split(":");
    return { kind, action, ref: rest.join(":") };
  }

  /**
   * The legend under the description.
   *
   * With values to show, every action gets a line of its own carrying the icon of
   * its button and what that setting currently is, grouped exactly like the rows
   * of buttons below it — so a line and its button are always found together.
   * Without values there is nothing to line up, so a row stays one compact line.
   *
   * @param {(key: string, vars?: object) => string} t
   * @param {Record<string, string>|null} values
   * @param {string|null} focus action the panel is currently asking about
   * @returns {string}
   */
  function legend(t, values, focus) {
    const name = (action) => t(`${actionsKey}.${action.id}`);

    if (!values) {
      return rows.map((row) => row.map((action) => `${action.emoji} ${name(action)}`).join("  ·  ")).join("\n");
    }

    return rows
      .map((row) =>
        row
          .map((action) => {
            // The one being edited is underlined, so a picker says what it is for.
            const label = action.id === focus ? `__${name(action)}__` : name(action);
            const value = values[action.id];
            return value ? `${action.emoji} **${label}:** ${value}` : `${action.emoji} **${label}**`;
          })
          .join("\n")
      )
      .join("\n\n");
  }

  /**
   * @param {(key: string, vars?: object) => string} t translator
   * @param {Object} [context]
   * @param {object} [context.settings] guild settings, for branding
   * @param {import('discord.js').Client} [context.client]
   * @param {Record<string, string>} [context.values] what each setting currently is
   * @param {string[]} [context.disabled] actions to render greyed out
   * @param {Record<string, number>} [context.styles] button styles overriding the declared ones
   * @param {string} [context.focus] action the panel is currently asking about
   * @returns {{embeds: EmbedBuilder[], components: ActionRowBuilder[]}}
   */
  function build(t, { settings, client, values = null, disabled = [], styles = {}, focus = null } = {}) {
    const description = [t(descriptionKey), "", legend(t, values, focus)];
    // Subtext keeps the hint readable without competing with the settings above it.
    if (hintKey) description.push("", `-# ${t(hintKey)}`);

    const title = icon ? `${icon} ${t(titleKey)}` : t(titleKey);

    const embed = new EmbedBuilder()
      .setColor(EMBED_COLORS.BOT_EMBED)
      .setTitle(fit(title, MAX_TITLE))
      .setDescription(fit(description.join("\n"), MAX_DESCRIPTION));

    applyBranding(embed, resolveBranding(settings, client), { force: true });

    const off = new Set(disabled);
    const components = rows.map((row) =>
      new ActionRowBuilder().addComponents(
        row.map((action) =>
          new ButtonBuilder()
            .setCustomId(buttonId(action.id))
            .setEmoji(action.emoji)
            .setStyle(styles[action.id] ?? action.style)
            .setDisabled(off.has(action.id))
        )
      )
    );

    return { embeds: [embed], components };
  }

  return {
    id,
    icon,
    rows,
    actions,
    actionIds,
    action: (name) => byId.get(name) || null,
    build,
    buttonId,
    selectId,
    modalId,
    matches,
    matchesButton,
    matchesSelect,
    matchesModal,
    parse,
  };
}

module.exports = { MAX_DESCRIPTION, MAX_TITLE, MODAL_MARK, SELECT_MARK, definePanel, fit };
