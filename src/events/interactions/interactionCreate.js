const { getSettings } = require("@schemas/Guild");
const {
  autoroleHandler,
  commandHandler,
  contextHandler,
  controlPanelHandler,
  formHandler,
  languageHandler,
  statsHandler,
  pollHandler,
  suggestionHandler,
  selfRoleHandler,
  verificationHandler,
  smartInvitesHandler,
  tempVoiceHandler,
  ticketHandler,
} = require("@src/handlers");
const { InteractionType } = require("discord.js");

// Discord gives three seconds to answer a click before it gives up on us, so
// anything approaching that is worth having in the log with its custom id.
const SLOW_INTERACTION_MS = 2000;

/**
 * @param {import('discord.js').BaseInteraction} interaction
 * @returns {string}
 */
function describe(interaction) {
  if (interaction.isChatInputCommand()) return `/${interaction.commandName}`;
  if (interaction.isContextMenuCommand()) return `context ${interaction.commandName}`;
  return `${interaction.customId || interaction.type}`;
}

/**
 * @param {import('@src/structures').BotClient} client
 * @param {import('discord.js').BaseInteraction} interaction
 */
module.exports = async (client, interaction) => {
  const startedAt = Date.now();

  try {
    return await route(client, interaction);
  } finally {
    const elapsed = Date.now() - startedAt;
    if (elapsed >= SLOW_INTERACTION_MS) {
      client.logger.warn(`Slow interaction: ${describe(interaction)} took ${elapsed}ms`);
    }
  }
};

/**
 * @param {import('@src/structures').BotClient} client
 * @param {import('discord.js').BaseInteraction} interaction
 */
async function route(client, interaction) {
  // A restart keeps the gateway open while caches, panels and command
  // registration are still being rebuilt. Answering immediately beats letting
  // the interaction expire into "the application did not respond".
  if (client.startupComplete === false) {
    return interaction
      .reply({ content: "I am still starting up. Try again in a moment.", ephemeral: true })
      .catch(() => {});
  }

  if (!interaction.guild) {
    return interaction
      .reply({ content: "Command can only be executed in a discord server", ephemeral: true })
      .catch(() => {});
  }

  client.telemetry?.recordInteraction(interaction);

  // Slash Commands
  if (interaction.isChatInputCommand()) {
    await commandHandler.handleSlashCommand(interaction);
  }

  // Context Menu
  else if (interaction.isContextMenuCommand()) {
    const context = client.contextMenus.get(interaction.commandName);
    if (context) await contextHandler.handleContext(interaction, context);
    else return interaction.reply({ content: "An error has occurred", ephemeral: true }).catch(() => {});
  }

  // Buttons
  else if (interaction.isButton()) {
    if (await smartInvitesHandler.handleButton(interaction)) return;

    // The settings panels: the hub and every system inside it.
    if (controlPanelHandler.matches(interaction.customId)) {
      return controlPanelHandler.handle(interaction, await getSettings(interaction.guild));
    }

    if (tempVoiceHandler.matchesButton(interaction.customId)) {
      return tempVoiceHandler.handleButton(interaction, await getSettings(interaction.guild));
    }

    // language picker: LANG:<auto|ru|en>
    if (interaction.customId.startsWith(`${languageHandler.BUTTON_PREFIX}:`)) {
      return languageHandler.handleButton(interaction, await getSettings(interaction.guild));
    }

    // form buttons carry the form id: FORM_FILL:<formId>
    if (interaction.customId.startsWith(`${formHandler.BUTTON_PREFIX}:`)) {
      return formHandler.handleFormButton(interaction);
    }

    // self role buttons carry the panel message and role: SELFROLE:<messageId>:<roleId>
    if (interaction.customId.startsWith(`${selfRoleHandler.BUTTON_PREFIX}:`)) {
      return selfRoleHandler.handleButton(interaction);
    }

    // poll close button: POLL_CLOSE:<messageId>
    if (interaction.customId.startsWith(`${pollHandler.CLOSE_PREFIX}:`)) {
      return pollHandler.handleClose(interaction);
    }

    if (interaction.customId === verificationHandler.BUTTON_ID) {
      return verificationHandler.handleVerifyButton(interaction, await getSettings(interaction.guild));
    }

    // The captcha prompt must open a modal, so it cannot be deferred first.
    if (interaction.customId === verificationHandler.MODAL_ID) {
      return verificationHandler.handleCodePrompt(interaction);
    }

    switch (interaction.customId) {
      case "TICKET_CREATE":
        return ticketHandler.handleTicketOpen(interaction);

      case "TICKET_CLOSE":
        return ticketHandler.handleTicketClose(interaction);

      case "SUGGEST_APPROVE":
        return suggestionHandler.handleApproveBtn(interaction);

      case "SUGGEST_REJECT":
        return suggestionHandler.handleRejectBtn(interaction);

      case "SUGGEST_DELETE":
        return suggestionHandler.handleDeleteBtn(interaction);
    }
  }

  // Select menus
  else if (interaction.isAnySelectMenu()) {
    // TempVoice asks "who?" with both string and user pickers.
    if (tempVoiceHandler.matchesSelect(interaction.customId)) {
      return tempVoiceHandler.handleSelect(interaction, await getSettings(interaction.guild));
    }

    if (controlPanelHandler.matches(interaction.customId)) {
      return controlPanelHandler.handle(interaction, await getSettings(interaction.guild));
    }

    // autorole pickers: AUTOROLE:<add|remove>
    if (autoroleHandler.matches(interaction.customId)) {
      return autoroleHandler.handleSelect(interaction, await getSettings(interaction.guild));
    }

    if (interaction.customId.startsWith(`${selfRoleHandler.SELECT_PREFIX}:`)) {
      return selfRoleHandler.handleSelect(interaction);
    }

    // poll voting: POLL_VOTE:<messageId>
    if (interaction.customId.startsWith(`${pollHandler.VOTE_PREFIX}:`)) {
      return pollHandler.handleVote(interaction);
    }
  }

  // Modals
  else if (interaction.type === InteractionType.ModalSubmit) {
    // form modals carry the form id: FORM_MODAL:<formId>
    if (interaction.customId.startsWith(`${formHandler.MODAL_PREFIX}:`)) {
      return formHandler.handleFormModal(interaction);
    }

    // temp voice modals carry the channel: TV~MOD:<action>:<channelId>
    if (tempVoiceHandler.matchesModal(interaction.customId)) {
      return tempVoiceHandler.handleModal(interaction, await getSettings(interaction.guild));
    }

    if (controlPanelHandler.matches(interaction.customId)) {
      return controlPanelHandler.handle(interaction, await getSettings(interaction.guild));
    }

    if (interaction.customId === verificationHandler.MODAL_ID) {
      return verificationHandler.handleCodeSubmit(interaction, await getSettings(interaction.guild));
    }

    switch (interaction.customId) {
      case "SUGGEST_APPROVE_MODAL":
        return suggestionHandler.handleApproveModal(interaction);

      case "SUGGEST_REJECT_MODAL":
        return suggestionHandler.handleRejectModal(interaction);

      case "SUGGEST_DELETE_MODAL":
        return suggestionHandler.handleDeleteModal(interaction);
    }
  }

  const settings = await getSettings(interaction.guild);

  // track stats
  if (settings.stats.enabled) statsHandler.trackInteractionStats(interaction).catch(() => {});
}
