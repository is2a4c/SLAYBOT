const { PermissionFlagsBits } = require("discord.js");
const { commandPanelHandler, controlPanelHandler } = require("@src/handlers");
const { guildTranslator } = require("@src/i18n");

/**
 * What the panel opens on depends on who opened it: somebody who may change the
 * server's settings lands on the hub, everybody else lands on the commands they
 * can actually run. Neither has to remember a command name to get there.
 *
 * @param {import('discord.js').Interaction|import('discord.js').Message} source
 * @param {object} settings guild settings document
 */
async function open(source, settings) {
  const t = guildTranslator(settings, source.guild);
  const member = source.member;

  if (member?.permissions?.has(PermissionFlagsBits.ManageGuild)) {
    return controlPanelHandler.buildHub(t, settings, source.client, source.guild);
  }

  return commandPanelHandler.buildCatalog(t, source, settings);
}

/**
 * @type {import("@structures/Command")}
 */
module.exports = {
  name: "panel",
  description: "configure every system and run every command from one panel",
  category: "ADMIN",
  botPermissions: ["EmbedLinks"],
  command: {
    enabled: true,
    aliases: ["settings", "setup", "menu"],
    usage: "",
  },
  slashCommand: {
    enabled: true,
    ephemeral: true,
    // The hub counts what the list panels hold, which is a database round-trip;
    // deferring keeps the click answered inside Discord's three seconds.
    options: [],
  },

  async messageRun(message, args, data) {
    return message.safeReply(await open(message, data.settings));
  },

  async interactionRun(interaction, data) {
    return interaction.safeFollowUp(await open(interaction, data.settings));
  },
};
