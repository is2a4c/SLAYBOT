const { ApplicationCommandOptionType } = require("discord.js");
const { autoroleHandler } = require("@src/handlers");
const { guildTranslator } = require("@src/i18n");
const { normalizeAutoRoles } = require("@handlers/memberRoles");

/**
 * @type {import("@structures/Command")}
 */
module.exports = {
  name: "autorole",
  description: "roles given to every member who joins the server",
  category: "ADMIN",
  userPermissions: ["ManageGuild"],
  botPermissions: ["ManageRoles"],
  command: {
    enabled: true,
    usage: "[add|remove|clear|list]",
    subcommands: [
      { trigger: "add", description: "pick roles to give new members" },
      { trigger: "remove", description: "pick roles to stop giving" },
      { trigger: "clear", description: "stop giving any role" },
      { trigger: "list", description: "show the roles new members get" },
    ],
  },
  slashCommand: {
    enabled: true,
    ephemeral: true,
    // Every subcommand answers from settings already in memory.
    defer: false,
    options: [
      {
        name: "add",
        description: "pick one or more roles to give new members",
        type: ApplicationCommandOptionType.Subcommand,
      },
      {
        name: "remove",
        description: "pick which of the current roles to stop giving",
        type: ApplicationCommandOptionType.Subcommand,
      },
      {
        name: "clear",
        description: "stop giving any role at all",
        type: ApplicationCommandOptionType.Subcommand,
      },
      {
        name: "list",
        description: "show the roles new members are given",
        type: ApplicationCommandOptionType.Subcommand,
      },
    ],
  },

  async messageRun(message, args, data) {
    const sub = (args[0] || "add").toLowerCase();
    const t = guildTranslator(data.settings, message.guild);

    // "off" is what this command has always called clearing the list.
    if (sub === "clear" || sub === "off") {
      return message.safeReply(await clear(t, data.settings));
    }

    if (sub === "list") {
      return message.safeReply({ embeds: [autoroleHandler.statusEmbed(t, data.settings, message.guild)] });
    }

    if (sub === "remove") {
      return message.safeReply(autoroleHandler.buildRemoveMenu(t, data.settings, message.guild));
    }

    return message.safeReply(autoroleHandler.buildAddMenu(t, data.settings, message.guild));
  },

  async interactionRun(interaction, data) {
    const sub = interaction.options.getSubcommand();
    const t = guildTranslator(data.settings, interaction.guild);
    const settings = data.settings;

    if (sub === "clear") {
      return interaction.reply({ content: await clear(t, settings), ephemeral: true });
    }

    if (sub === "list") {
      return interaction.reply({
        embeds: [autoroleHandler.statusEmbed(t, settings, interaction.guild)],
        ephemeral: true,
      });
    }

    const menu =
      sub === "remove"
        ? autoroleHandler.buildRemoveMenu(t, settings, interaction.guild)
        : autoroleHandler.buildAddMenu(t, settings, interaction.guild);

    return interaction.reply({ ...menu, ephemeral: true });
  },
};

/**
 * @param {(key: string, vars?: object) => string} t
 * @param {object} settings guild settings document
 */
async function clear(t, settings) {
  if (!normalizeAutoRoles(settings.autorole).length) return t("autorole.empty");

  settings.autorole = [];
  await settings.save();

  return t("autorole.cleared");
}
