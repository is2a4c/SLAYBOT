const { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require("discord.js");
const { MAX_MODAL_INPUTS, MAX_MODAL_TITLE } = require("@schemas/CustomCommand");

/**
 * Turning a SHOW_MODAL action into the modal Discord actually renders.
 *
 * Only what Discord's modal API takes is here: a title and up to five text
 * inputs. Discord has no file component on a modal at all, so nothing here
 * pretends to offer one.
 */

const MODAL_PREFIX = "CCMODAL";

/**
 * @param {string} token from modalSessions.create
 * @returns {string}
 */
function modalCustomId(token) {
  return `${MODAL_PREFIX}:${token}`;
}

/**
 * @param {string} customId
 * @returns {string|null} the token, or null when this custom id is not one of ours
 */
function parseModalCustomId(customId) {
  const text = String(customId || "");
  return text.startsWith(`${MODAL_PREFIX}:`) ? text.slice(MODAL_PREFIX.length + 1) : null;
}

/**
 * @param {object} input stored modal input
 * @returns {TextInputBuilder}
 */
function buildTextInput(input) {
  const builder = new TextInputBuilder()
    .setCustomId(String(input.id).slice(0, 100))
    .setLabel(String(input.label || input.id).slice(0, 45))
    .setStyle(input.style === "PARAGRAPH" ? TextInputStyle.Paragraph : TextInputStyle.Short)
    .setRequired(input.required !== false);

  if (Number.isFinite(input.min_length)) builder.setMinLength(input.min_length);
  if (Number.isFinite(input.max_length)) builder.setMaxLength(input.max_length);
  if (input.placeholder) builder.setPlaceholder(String(input.placeholder).slice(0, 100));

  return builder;
}

/**
 * @param {object} action a SHOW_MODAL action
 * @param {string} token identifies the session waiting for the answer
 * @returns {ModalBuilder}
 */
function buildModal(action, token) {
  const inputs = (action.modal_inputs || []).slice(0, MAX_MODAL_INPUTS);
  return new ModalBuilder({
    customId: modalCustomId(token),
    title: String(action.modal_title || "Form").slice(0, MAX_MODAL_TITLE),
    components: inputs.map((input) => new ActionRowBuilder().addComponents(buildTextInput(input))),
  });
}

module.exports = { MODAL_PREFIX, buildModal, buildTextInput, modalCustomId, parseModalCustomId };
