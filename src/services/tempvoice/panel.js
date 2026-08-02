const { ButtonStyle } = require("discord.js");
const { definePanel } = require("@src/services/panels/definePanel");

/**
 * The panel layout. Three rows of five, in the same order as the embed legend,
 * so the icons under the text line up with their names.
 */
const ACTION_ROWS = [
  [
    { id: "name", emoji: "✏️", style: ButtonStyle.Secondary },
    { id: "limit", emoji: "🔢", style: ButtonStyle.Secondary },
    { id: "access", emoji: "🔒", style: ButtonStyle.Secondary },
    { id: "lobby", emoji: "👁️", style: ButtonStyle.Secondary },
    { id: "chat", emoji: "💬", style: ButtonStyle.Secondary },
  ],
  [
    { id: "trust", emoji: "🤝", style: ButtonStyle.Success },
    { id: "untrust", emoji: "🚷", style: ButtonStyle.Secondary },
    { id: "invite", emoji: "📨", style: ButtonStyle.Primary },
    { id: "kick", emoji: "👢", style: ButtonStyle.Danger },
    { id: "region", emoji: "🌍", style: ButtonStyle.Secondary },
  ],
  [
    { id: "ban", emoji: "🔨", style: ButtonStyle.Danger },
    { id: "unban", emoji: "🕊️", style: ButtonStyle.Success },
    { id: "claim", emoji: "👑", style: ButtonStyle.Primary },
    { id: "transfer", emoji: "🔑", style: ButtonStyle.Secondary },
    { id: "delete", emoji: "🗑️", style: ButtonStyle.Danger },
  ],
];

const panel = definePanel({
  id: "TV",
  titleKey: "tempvoice.panel.title",
  icon: "🎙️",
  descriptionKey: "tempvoice.panel.description",
  hintKey: "tempvoice.panel.hint",
  actionsKey: "tempvoice.actions",
  rows: ACTION_ROWS,
});

/**
 * Actions that ask "who?" before they do anything, and the prompt they ask with.
 */
const MEMBER_PICKERS = {
  trust: "pickTrust",
  untrust: "pickUntrust",
  invite: "pickTrust",
  kick: "pickKick",
  ban: "pickBan",
  unban: "pickUnban",
  transfer: "pickTransfer",
};

module.exports = {
  ACTIONS: panel.actions,
  ACTION_IDS: panel.actionIds,
  ACTION_ROWS,
  MEMBER_PICKERS,
  buildPanel: panel.build,
  buttonId: panel.buttonId,
  matchesButton: panel.matchesButton,
  matchesModal: panel.matchesModal,
  matchesSelect: panel.matchesSelect,
  modalId: panel.modalId,
  parse: panel.parse,
  selectId: panel.selectId,
};
