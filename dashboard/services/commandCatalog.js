const { ApplicationCommandOptionType } = require("discord.js");

const CATEGORY_ORDER = [
  "ADMIN",
  "MODERATION",
  "AUTOMOD",
  "TICKET",
  "SUGGESTION",
  "INVITE",
  "GIVEAWAY",
  "INFORMATION",
  "UTILITY",
  "SOCIAL",
  "STATS",
  "ECONOMY",
  "MUSIC",
  "FUN",
  "IMAGE",
  "ANIME",
  "OWNER",
];

function uniqueCommands(client) {
  const commands = new Map();
  for (const command of client.commands || []) commands.set(command.name, command);
  for (const command of client.slashCommands?.values?.() || []) commands.set(command.name, command);
  return [...commands.values()];
}

function permissionNames(value) {
  if (!Array.isArray(value)) return [];
  return value.map(String);
}

function holderHasPermissions(holder, required) {
  if (required.length === 0) return true;
  return Boolean(holder?.permissions?.has(required));
}

function slashUsages(command) {
  if (!command.slashCommand?.enabled) return [];
  const options = command.slashCommand.options || [];
  const usages = [];

  for (const option of options) {
    if (option.type === ApplicationCommandOptionType.SubcommandGroup) {
      for (const subcommand of option.options || []) {
        if (subcommand.type === ApplicationCommandOptionType.Subcommand) {
          usages.push(`/${command.name} ${option.name} ${subcommand.name}`);
        }
      }
    } else if (option.type === ApplicationCommandOptionType.Subcommand) {
      usages.push(`/${command.name} ${option.name}`);
    }
  }

  return usages.length > 0 ? usages : [`/${command.name}`];
}

function prefixUsages(command, prefix) {
  if (!command.command?.enabled) return [];
  const subcommands = command.command.subcommands || [];
  if (subcommands.length > 0) {
    return subcommands.map((subcommand) => `${prefix}${command.name} ${subcommand.trigger}`);
  }
  const suffix = String(command.command.usage || "").trim();
  return [`${prefix}${command.name}${suffix ? ` ${suffix}` : ""}`];
}

function categoryRank(category) {
  const index = CATEGORY_ORDER.indexOf(category);
  return index === -1 ? CATEGORY_ORDER.length : index;
}

function buildCommandCatalog({ client, guild, member, isOwner, prefix = "!" }) {
  const botMember = guild.members.me;
  const commands = uniqueCommands(client)
    .filter((command) => isOwner || command.category !== "OWNER")
    .map((command) => {
      const userPermissions = permissionNames(command.userPermissions);
      const botPermissions = permissionNames(command.botPermissions);
      const userReady = holderHasPermissions(member, userPermissions);
      const botReady = holderHasPermissions(botMember, botPermissions);
      const memberPresent = Boolean(member);

      return {
        name: command.name,
        description: command.description || "",
        category: command.category || "OTHER",
        cooldown: Number(command.cooldown || 0),
        userPermissions,
        botPermissions,
        slashUsages: slashUsages(command),
        prefixUsages: prefixUsages(command, prefix),
        memberPresent,
        userReady: memberPresent && userReady,
        botReady,
        ready: memberPresent && userReady && botReady,
      };
    })
    .sort(
      (left, right) =>
        categoryRank(left.category) - categoryRank(right.category) ||
        left.name.localeCompare(right.name, "en")
    );

  const categories = [...new Set(commands.map((command) => command.category))];
  return {
    commands,
    categories,
    summary: {
      total: commands.length,
      ready: commands.filter((command) => command.ready).length,
      userBlocked: commands.filter((command) => command.memberPresent && !command.userReady).length,
      botBlocked: commands.filter((command) => !command.botReady).length,
    },
  };
}

module.exports = {
  buildCommandCatalog,
  prefixUsages,
  slashUsages,
};
