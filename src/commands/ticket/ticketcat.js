const { ApplicationCommandOptionType, EmbedBuilder } = require("discord.js");
const { getTicketChannels } = require("@handlers/ticket");
const { parseRoleIds, syncCategoryStaffRoleAccess } = require("@helpers/TicketPermissions");

const MAX_CATEGORIES = 25;
const MAX_CATEGORY_NAME_LENGTH = 100;
const MAX_CATEGORY_STAFF_ROLES = 25;

/**
 * @type {import("@structures/Command")}
 */
module.exports = {
  name: "ticketcat",
  description: "manage ticket categories",
  category: "TICKET",
  userPermissions: ["ManageGuild"],
  command: {
    enabled: true,
    minArgsCount: 1,
    subcommands: [
      {
        trigger: "list",
        description: "list all ticket categories",
      },
      {
        trigger: "add <category> | <staff_roles>",
        description: "add a ticket category",
      },
      {
        trigger: "remove <category>",
        description: "remove a ticket category",
      },
      {
        trigger: "staff-add <category> | <@role>",
        description: "add a support role to a ticket category",
      },
      {
        trigger: "staff-remove <category> | <@role>",
        description: "remove a support role from a ticket category",
      },
    ],
  },
  slashCommand: {
    enabled: true,
    ephemeral: true,
    options: [
      {
        name: "list",
        description: "list all ticket categories",
        type: ApplicationCommandOptionType.Subcommand,
      },
      {
        name: "add",
        description: "add a ticket category",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "category",
            description: "the category name",
            type: ApplicationCommandOptionType.String,
            required: true,
          },
          {
            name: "staff_role",
            description: "an optional initial support role",
            type: ApplicationCommandOptionType.Role,
            required: false,
          },
        ],
      },
      {
        name: "remove",
        description: "remove a ticket category",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "category",
            description: "the category name",
            type: ApplicationCommandOptionType.String,
            required: true,
          },
        ],
      },
      {
        name: "staff-add",
        description: "add a support role to a ticket category",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "category",
            description: "the category name",
            type: ApplicationCommandOptionType.String,
            required: true,
          },
          {
            name: "role",
            description: "the support role",
            type: ApplicationCommandOptionType.Role,
            required: true,
          },
        ],
      },
      {
        name: "staff-remove",
        description: "remove a support role from a ticket category",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "category",
            description: "the category name",
            type: ApplicationCommandOptionType.String,
            required: true,
          },
          {
            name: "role",
            description: "the support role",
            type: ApplicationCommandOptionType.Role,
            required: true,
          },
        ],
      },
    ],
  },

  async messageRun(message, args, data) {
    const sub = args[0].toLowerCase();
    let response;

    // list
    if (sub === "list") {
      response = listCategories(data);
    }

    // add
    else if (sub === "add") {
      const split = args.slice(1).join(" ").split("|");
      const category = split[0].trim();
      const roleIds = resolveRoleIds(message.guild, split[1], message.mentions.roles);
      if (split[1]?.trim() && roleIds.length === 0) {
        response = "No valid staff roles found. Mention roles after the `|` separator.";
      } else {
        response = await addCategory(data, category, roleIds);
      }
    }

    // remove
    else if (sub === "remove") {
      const category = args.slice(1).join(" ").trim();
      response = await removeCategory(message.guild, data, category);
    }

    // add category staff role
    else if (sub === "staff-add") {
      const split = args.slice(1).join(" ").split("|");
      const category = split[0].trim();
      const role = resolveSingleRole(message.guild, split[1], message.mentions.roles);
      response = await addCategoryStaffRole(message.guild, data.settings, category, role);
    }

    // remove category staff role
    else if (sub === "staff-remove") {
      const split = args.slice(1).join(" ").split("|");
      const category = split[0].trim();
      const role = resolveSingleRole(message.guild, split[1], message.mentions.roles);
      response = await removeCategoryStaffRole(message.guild, data.settings, category, role);
    }

    // invalid subcommand
    else {
      response = "Invalid subcommand.";
    }

    await message.safeReply(response);
  },

  async interactionRun(interaction, data) {
    const sub = interaction.options.getSubcommand();
    let response;

    // list
    if (sub === "list") {
      response = listCategories(data);
    }

    // add
    else if (sub === "add") {
      const category = interaction.options.getString("category");
      const role = interaction.options.getRole("staff_role");
      response = await addCategory(data, category, role ? [role.id] : []);
    }

    // remove
    else if (sub === "remove") {
      const category = interaction.options.getString("category");
      response = await removeCategory(interaction.guild, data, category);
    }

    // add category staff role
    else if (sub === "staff-add") {
      const category = interaction.options.getString("category");
      const role = interaction.options.getRole("role");
      response = await addCategoryStaffRole(interaction.guild, data.settings, category, role);
    }

    // remove category staff role
    else if (sub === "staff-remove") {
      const category = interaction.options.getString("category");
      const role = interaction.options.getRole("role");
      response = await removeCategoryStaffRole(interaction.guild, data.settings, category, role);
    }

    //
    else response = "Invalid subcommand";
    await interaction.followUp(response);
  },
};

function listCategories(data) {
  const categories = data.settings.ticket.categories;
  if (categories?.length === 0) return "No ticket categories found.";

  const fields = [];
  for (const category of categories.slice(0, MAX_CATEGORIES)) {
    const roleNames = (category.staff_roles || []).map((r) => `<@&${r}>`).join(", ");
    fields.push({ name: category.name, value: `**Staff:** ${roleNames || "None"}` });
  }
  const embed = new EmbedBuilder().setAuthor({ name: "Ticket Categories" }).addFields(fields);
  return { embeds: [embed] };
}

async function addCategory(data, category, staffRoleIds) {
  if (!category) return "Invalid usage! Missing category name.";
  if (category.includes("|")) return "Category names cannot contain `|`.";
  if (category.length > MAX_CATEGORY_NAME_LENGTH) {
    return `Category names cannot exceed ${MAX_CATEGORY_NAME_LENGTH} characters.`;
  }
  if (data.settings.ticket.categories.length >= MAX_CATEGORIES) {
    return `You can configure a maximum of ${MAX_CATEGORIES} ticket categories.`;
  }

  // check if category already exists
  if (data.settings.ticket.categories.find((c) => c.name === category)) {
    return `Category \`${category}\` already exists.`;
  }

  data.settings.ticket.categories.push({ name: category, staff_roles: staffRoleIds });
  await data.settings.save();

  return `Category \`${category}\` added.`;
}

async function removeCategory(guild, data, categoryName) {
  const categories = data.settings.ticket.categories;
  const category = categories.find((entry) => entry.name === categoryName);
  if (!category) {
    return `Category \`${categoryName}\` does not exist.`;
  }

  const roleIds = [...(category.staff_roles || [])];
  data.settings.ticket.categories = categories.filter((entry) => entry.name !== categoryName);
  await data.settings.save();

  const result = await syncCategoryRoles(guild, data.settings, categoryName, roleIds, false);
  return (
    `Category \`${categoryName}\` removed. Updated ${result.updated} role overwrite(s)` +
    (result.failed > 0 ? `; failed to update ${result.failed}.` : ".")
  );
}

async function addCategoryStaffRole(guild, settings, categoryName, role) {
  if (!role || role.id === guild.id) return "Please provide a valid support role.";

  const category = settings.ticket.categories.find((entry) => entry.name === categoryName);
  if (!category) return `Category \`${categoryName}\` does not exist.`;

  const roleIds = category.staff_roles || [];
  if (roleIds.includes(role.id)) return `${role.toString()} already supports category \`${categoryName}\`.`;
  if (roleIds.length >= MAX_CATEGORY_STAFF_ROLES) {
    return `You can configure a maximum of ${MAX_CATEGORY_STAFF_ROLES} support roles per category.`;
  }

  category.staff_roles = [...roleIds, role.id];
  await settings.save();

  const result = await syncCategoryStaffRoleAccess(getTicketChannels(guild), settings, categoryName, role, true);
  return (
    `${role.toString()} can now work with category \`${categoryName}\`. Updated ${result.updated} open ticket(s)` +
    (result.failed > 0 ? `; failed to update ${result.failed}.` : ".")
  );
}

async function removeCategoryStaffRole(guild, settings, categoryName, role) {
  if (!role) return "Please provide a valid support role.";

  const category = settings.ticket.categories.find((entry) => entry.name === categoryName);
  if (!category) return `Category \`${categoryName}\` does not exist.`;

  const roleIds = category.staff_roles || [];
  if (!roleIds.includes(role.id)) return `${role.toString()} does not support category \`${categoryName}\`.`;

  category.staff_roles = roleIds.filter((roleId) => roleId !== role.id);
  await settings.save();

  const result = await syncCategoryStaffRoleAccess(getTicketChannels(guild), settings, categoryName, role, false);
  return (
    `${role.toString()} was removed from category \`${categoryName}\`. Updated ${result.updated} open ticket(s)` +
    (result.failed > 0 ? `; failed to update ${result.failed}.` : ".")
  );
}

async function syncCategoryRoles(guild, settings, categoryName, roleIds, enabled) {
  const totals = { updated: 0, failed: 0 };
  const channels = getTicketChannels(guild);

  for (const roleId of roleIds) {
    const result = await syncCategoryStaffRoleAccess(channels, settings, categoryName, roleId, enabled);
    totals.updated += result.updated;
    totals.failed += result.failed;
  }

  return totals;
}

function resolveRoleIds(guild, input, mentionedRoles) {
  const mentionedRoleIds = mentionedRoles ? [...mentionedRoles.keys()] : [];
  return [...new Set([...mentionedRoleIds, ...parseRoleIds(input)])].filter(
    (roleId) => roleId !== guild.id && guild.roles.cache.has(roleId)
  );
}

function resolveSingleRole(guild, input, mentionedRoles) {
  const roleId = resolveRoleIds(guild, input, mentionedRoles)[0];
  return roleId ? guild.roles.cache.get(roleId) : null;
}
