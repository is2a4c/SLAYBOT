const { ApplicationCommandOptionType } = require("discord.js");
const { normalizeAutoRoles } = require("@handlers/memberRoles");

// Matches the cap the dashboard applies, so both ways in agree.
const MAX_AUTOROLES = 10;

/**
 * @type {import("@structures/Command")}
 */
module.exports = {
  name: "autorole",
  description: "setup roles to be given when a member joins the server",
  category: "ADMIN",
  userPermissions: ["ManageGuild"],
  command: {
    enabled: true,
    usage: "<role|off>",
    minArgsCount: 1,
  },
  slashCommand: {
    enabled: true,
    ephemeral: true,
    options: [
      {
        name: "add",
        description: "give this role to new members",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "role",
            description: "the role to be given",
            type: ApplicationCommandOptionType.Role,
            required: false,
          },
          {
            name: "role_id",
            description: "the role id to be given",
            type: ApplicationCommandOptionType.String,
            required: false,
          },
        ],
      },
      {
        name: "remove",
        description: "stop giving a role, or all of them",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "role",
            description: "the role to stop giving; leave empty to remove every autorole",
            type: ApplicationCommandOptionType.Role,
            required: false,
          },
        ],
      },
      {
        name: "list",
        description: "show the roles new members are given",
        type: ApplicationCommandOptionType.Subcommand,
      },
    ],
  },

  async messageRun(message, args, data) {
    const input = args.join(" ");

    if (input.toLowerCase() === "off") {
      return message.safeReply(await removeAutoRole(message.guild, null, data.settings));
    }

    const roles = message.guild.findMatchingRoles(input);
    if (roles.length === 0) return message.safeReply("No matching roles found matching your query");

    return message.safeReply(await addAutoRole(message.guild, roles[0], data.settings));
  },

  async interactionRun(interaction, data) {
    const sub = interaction.options.getSubcommand();
    const settings = data.settings;

    if (sub === "list") return interaction.safeFollowUp(listAutoRoles(settings));

    if (sub === "remove") {
      return interaction.safeFollowUp(
        await removeAutoRole(interaction.guild, interaction.options.getRole("role"), settings)
      );
    }

    if (sub === "add") {
      let role = interaction.options.getRole("role");
      if (!role) {
        const roleId = interaction.options.getString("role_id");
        if (!roleId) return interaction.safeFollowUp("Please provide a role or role id");

        const roles = interaction.guild.findMatchingRoles(roleId);
        if (roles.length === 0) return interaction.safeFollowUp("No matching roles found matching your query");
        role = roles[0];
      }

      return interaction.safeFollowUp(await addAutoRole(interaction.guild, role, settings));
    }

    return interaction.safeFollowUp("Invalid subcommand");
  },
};

/**
 * @param {import('discord.js').Guild} guild
 * @param {import('discord.js').Role} role
 * @returns {string|null} why the role cannot be handed out
 */
function roleProblem(guild, role) {
  if (role.id === guild.roles.everyone.id) return "You cannot set `@everyone` as an autorole";
  if (!guild.members.me.permissions.has("ManageRoles")) return "I don't have the `ManageRoles` permission";
  if (guild.members.me.roles.highest.position < role.position) {
    return "I don't have the permissions to assign this role";
  }
  if (role.managed) return "Oops! This role is managed by an integration";
  return null;
}

/**
 * @param {import('discord.js').Guild} guild
 * @param {import('discord.js').Role} role
 * @param {object} settings guild settings document
 */
async function addAutoRole(guild, role, settings) {
  const problem = roleProblem(guild, role);
  if (problem) return problem;

  const current = normalizeAutoRoles(settings.autorole);
  if (current.includes(role.id)) return `${role} is already given to new members`;
  if (current.length >= MAX_AUTOROLES) return `You can have at most ${MAX_AUTOROLES} autoroles`;

  settings.autorole = [...current, role.id];
  await settings.save();

  return `New members now get ${role}. Autoroles: ${settings.autorole.length}`;
}

/**
 * @param {import('discord.js').Guild} guild
 * @param {import('discord.js').Role|null} role removes every autorole when omitted
 * @param {object} settings guild settings document
 */
async function removeAutoRole(guild, role, settings) {
  const current = normalizeAutoRoles(settings.autorole);

  if (!role) {
    if (!current.length) return "There are no autoroles to remove";
    settings.autorole = [];
    await settings.save();
    return "Autorole is disabled. New members are given nothing";
  }

  if (!current.includes(role.id)) return `${role} is not an autorole`;

  settings.autorole = current.filter((id) => id !== role.id);
  await settings.save();

  return settings.autorole.length
    ? `${role} is no longer given. Autoroles: ${settings.autorole.length}`
    : `${role} is no longer given. Autorole is now disabled`;
}

/**
 * @param {object} settings guild settings document
 */
function listAutoRoles(settings) {
  const current = normalizeAutoRoles(settings.autorole);
  if (!current.length) return "No autoroles are set. New members are given nothing";

  return `New members are given: ${current.map((id) => `<@&${id}>`).join(", ")}`;
}
