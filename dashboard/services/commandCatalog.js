const { ApplicationCommandOptionType } = require("discord.js");
const { categoryDisabled, commandPolicy, effectiveCooldown } = require("@src/services/commands/policy");

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

/**
 * Every command of the bot, with what this server did to it.
 *
 * `ready` stays what it always was — whether Discord's permissions let it run —
 * and the server's own policy is reported next to it rather than folded into it,
 * so the page can say which of the two is standing in the way.
 *
 * @param {Object} input
 * @param {object} [input.settings] guild settings, for the command policy
 */
function buildCommandCatalog({ client, guild, member, isOwner, prefix = "!", settings = null }) {
  const botMember = guild.members.me;
  const commands = uniqueCommands(client)
    .filter((command) => isOwner || command.category !== "OWNER")
    .map((command) => {
      const userPermissions = permissionNames(command.userPermissions);
      const botPermissions = permissionNames(command.botPermissions);
      const userReady = holderHasPermissions(member, userPermissions);
      const botReady = holderHasPermissions(botMember, botPermissions);
      const memberPresent = Boolean(member);
      const policy = commandPolicy(settings, command.name);
      const groupOff = categoryDisabled(settings, command.category || "OTHER");

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
        policy: {
          enabled: policy?.enabled !== false,
          groupDisabled: groupOff,
          cooldownSeconds: policy?.cooldown_seconds ?? null,
          effectiveCooldown: effectiveCooldown(settings, command),
          allowedRoles: [...(policy?.allowed_roles || [])],
          allowedChannels: [...(policy?.allowed_channels || [])],
          restricted: Boolean(
            groupOff || policy?.enabled === false || policy?.allowed_roles?.length || policy?.allowed_channels?.length
          ),
        },
      };
    })
    .sort(
      (left, right) =>
        categoryRank(left.category) - categoryRank(right.category) || left.name.localeCompare(right.name, "en")
    );

  const categories = [...new Set(commands.map((command) => command.category))].map((id) => ({
    id,
    disabled: categoryDisabled(settings, id),
    count: commands.filter((command) => command.category === id).length,
  }));

  return {
    commands,
    categories,
    summary: {
      total: commands.length,
      ready: commands.filter((command) => command.ready).length,
      userBlocked: commands.filter((command) => command.memberPresent && !command.userReady).length,
      botBlocked: commands.filter((command) => !command.botReady).length,
      restricted: commands.filter((command) => command.policy.restricted).length,
    },
  };
}

module.exports = {
  buildCommandCatalog,
  prefixUsages,
  slashUsages,
};
