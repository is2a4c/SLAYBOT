const { ApplicationCommandOptionType } = require("discord.js");
const { addInvites } = require("./addinvites");
const { getInviteCodes } = require("./invitecodes");
const { getInviter } = require("./inviter");
const { getInvites } = require("./invites");
const { importInvites } = require("./invitesimport");
const { setStatus } = require("./invitetracker");
const { clearInvites } = require("./resetInvites");
const { getInviteRanks } = require("./inviteranks");
const { addInviteRank, removeInviteRank } = require("./inviterank");

const userOption = (description, required = false) => ({
  name: "user",
  description,
  type: ApplicationCommandOptionType.User,
  required,
});

/**
 * Single slash entry point for invite tracking.
 *
 * Every invite feature keeps its own prefix command (`!invites`, `!addinvites`, …);
 * their slash surfaces are gathered here because Discord allows an application only
 * 100 slash commands and ten separate invite commands were not worth the budget.
 *
 * @type {import("@structures/Command")}
 */
module.exports = {
  name: "invites",
  description: "invite tracking, invite ranks and invite management",
  category: "INVITE",
  botPermissions: ["EmbedLinks"],
  command: {
    // `!invites` is served by invites.js
    enabled: false,
  },
  slashCommand: {
    enabled: true,
    options: [
      {
        name: "count",
        description: "show how many invites a member has",
        type: ApplicationCommandOptionType.Subcommand,
        options: [userOption("member to look up (defaults to you)")],
      },
      {
        name: "codes",
        description: "list the invite codes a member created",
        type: ApplicationCommandOptionType.Subcommand,
        options: [userOption("member to look up (defaults to you)")],
      },
      {
        name: "inviter",
        description: "show who invited a member",
        type: ApplicationCommandOptionType.Subcommand,
        options: [userOption("member to look up (defaults to you)")],
      },
      {
        name: "ranks",
        description: "show the invite ranks of this server",
        type: ApplicationCommandOptionType.Subcommand,
      },
      {
        name: "rank-add",
        description: "give a role automatically after a number of invites",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: "role", description: "role to be given", type: ApplicationCommandOptionType.Role, required: true },
          {
            name: "invites",
            description: "number of invites required",
            type: ApplicationCommandOptionType.Integer,
            required: true,
            minValue: 1,
          },
        ],
      },
      {
        name: "rank-remove",
        description: "remove a configured invite rank",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "role",
            description: "role with a configured invite rank",
            type: ApplicationCommandOptionType.Role,
            required: true,
          },
        ],
      },
      {
        name: "add",
        description: "add invites to a member",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          userOption("member receiving the invites", true),
          {
            name: "invites",
            description: "number of invites to add",
            type: ApplicationCommandOptionType.Integer,
            required: true,
            minValue: 1,
          },
        ],
      },
      {
        name: "reset",
        description: "clear the invites added to a member",
        type: ApplicationCommandOptionType.Subcommand,
        options: [userOption("member to reset", true)],
      },
      {
        name: "import",
        description: "import the invite uses that already exist on this server",
        type: ApplicationCommandOptionType.Subcommand,
        options: [userOption("only import for this member")],
      },
      {
        name: "tracker",
        description: "turn invite tracking on or off",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "status",
            description: "configuration status",
            type: ApplicationCommandOptionType.String,
            required: true,
            choices: [
              { name: "ON", value: "ON" },
              { name: "OFF", value: "OFF" },
            ],
          },
        ],
      },
    ],
  },

  async interactionRun(interaction, data) {
    const sub = interaction.options.getSubcommand();
    const settings = data.settings;

    // Management subcommands stay behind Manage Server, the read-only ones do not.
    const managed = ["rank-add", "rank-remove", "add", "reset", "import", "tracker"];
    if (managed.includes(sub) && !interaction.member.permissions.has("ManageGuild")) {
      return interaction.followUp("You need the `Manage Server` permission for this subcommand");
    }

    const target = interaction.options.getUser("user");

    switch (sub) {
      case "count":
        return interaction.followUp(await getInvites(interaction, target || interaction.user, settings));

      case "codes":
        return interaction.followUp(await getInviteCodes(interaction, target || interaction.user));

      case "inviter":
        return interaction.followUp(await getInviter(interaction, target || interaction.user, settings));

      case "ranks":
        return interaction.followUp(await getInviteRanks(interaction, settings));

      case "rank-add":
        return interaction.followUp(
          await addInviteRank(
            interaction,
            interaction.options.getRole("role"),
            interaction.options.getInteger("invites"),
            settings
          )
        );

      case "rank-remove":
        return interaction.followUp(await removeInviteRank(interaction, interaction.options.getRole("role"), settings));

      case "add":
        return interaction.followUp(await addInvites(interaction, target, interaction.options.getInteger("invites")));

      case "reset":
        return interaction.followUp(await clearInvites(interaction, target));

      case "import":
        return interaction.followUp(await importInvites(interaction, target));

      case "tracker":
        return interaction.followUp(await setStatus(interaction, interaction.options.getString("status"), settings));

      default:
        return interaction.followUp("Invalid subcommand");
    }
  },
};
