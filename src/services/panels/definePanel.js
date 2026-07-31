const { ActionRowBuilder, ButtonBuilder, EmbedBuilder } = require("discord.js");
const { EMBED_COLORS } = require("@root/config");
const { applyBranding, resolveBranding } = require("@helpers/Branding");

/**
 * Every control surface in the bot is the same shape: an embed that names what
 * the icons do, and rows of icon buttons underneath. This builds one from a
 * declaration so the systems stay consistent and only differ in their actions.
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
 * @param {string} definition.descriptionKey
 * @param {string} definition.actionsKey translation prefix for the action names
 * @param {string} [definition.hintKey] closing line under the legend
 * @param {PanelAction[][]} definition.rows up to five rows of up to five actions
 */
function definePanel({ id, titleKey, descriptionKey, actionsKey, hintKey, rows }) {
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
   * @param {(key: string, vars?: object) => string} t translator
   * @param {Object} [context]
   * @param {object} [context.settings] guild settings, for branding
   * @param {import('discord.js').Client} [context.client]
   * @param {string[]} [context.status] lines describing the current configuration
   * @param {string[]} [context.disabled] actions to render greyed out
   * @returns {{embeds: EmbedBuilder[], components: ActionRowBuilder[]}}
   */
  function build(t, { settings, client, status = [], disabled = [] } = {}) {
    const legend = rows
      .map((row) => row.map((action) => `${action.emoji} ${t(`${actionsKey}.${action.id}`)}`).join("  ·  "))
      .join("\n");

    const description = [t(descriptionKey), "", ...(status.length ? [...status, ""] : []), legend];
    if (hintKey) description.push("", t(hintKey));

    const embed = new EmbedBuilder()
      .setColor(EMBED_COLORS.BOT_EMBED)
      .setTitle(t(titleKey))
      .setDescription(description.join("\n"));

    applyBranding(embed, resolveBranding(settings, client), { force: true });

    const off = new Set(disabled);
    const components = rows.map((row) =>
      new ActionRowBuilder().addComponents(
        row.map((action) =>
          new ButtonBuilder()
            .setCustomId(buttonId(action.id))
            .setEmoji(action.emoji)
            .setStyle(action.style)
            .setDisabled(off.has(action.id))
        )
      )
    );

    return { embeds: [embed], components };
  }

  return {
    id,
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

module.exports = { MODAL_MARK, SELECT_MARK, definePanel };
