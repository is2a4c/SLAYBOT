const { ApplicationCommandOptionType, PermissionFlagsBits } = require("discord.js");
const { OWNER_IDS } = require("@root/config");
// Straight from the file rather than through the structures index: that index
// pulls in the whole client, and this only needs the names and icons.
const CommandCategory = require("@src/structures/CommandCategory");
const { ICONS } = require("@src/services/panels/fieldEditor");

/**
 * The bot's commands, read as a tree the panel can walk.
 *
 * Nothing here is written by hand: a command declares its options once, for
 * Discord, and the same declaration is what the panel draws. A command added
 * tomorrow shows up in the panel without touching this file.
 *
 * The tree is category → command → leaf, where a leaf is what actually runs: the
 * command itself, or one of its subcommands.
 */

const OPTION = ApplicationCommandOptionType;

// Discord takes at most 25 rows in a select menu.
const PAGE = 25;

/**
 * Panel field type for a Discord option type, or null for something the panel
 * cannot ask for.
 *
 * @param {object} option
 * @returns {string|null}
 */
function fieldType(option) {
  if (option.choices?.length) return "choice";

  switch (option.type) {
    case OPTION.String:
      return "text";
    case OPTION.Integer:
    case OPTION.Number:
      return "number";
    case OPTION.Boolean:
      return "toggle";
    case OPTION.Channel:
      return "channel";
    case OPTION.Role:
      return "role";
    case OPTION.User:
    case OPTION.Mentionable:
      return "user";
    default:
      return null;
  }
}

/**
 * One option of a leaf, in the shape the panel's renderer understands.
 *
 * @param {object} option raw Discord option declaration
 */
function describeOption(option) {
  const type = fieldType(option);
  if (!type) return null;

  return {
    id: option.name,
    name: option.name.replaceAll("_", " "),
    description: option.description || "",
    emoji: ICONS[type],
    type,
    required: Boolean(option.required),
    choices: option.choices?.map((choice) => String(choice.value)) || null,
    choiceLabels: Object.fromEntries((option.choices || []).map((choice) => [String(choice.value), choice.name])),
    channelTypes: option.channelTypes || option.channel_types || null,
    // Only what the command actually declared. Standing in 0 and 999999 for the
    // options that declare nothing quietly rewrote what somebody typed: a
    // transfer of five million became 999999, and no limit was ever mentioned.
    min: option.minValue ?? option.min_value ?? null,
    max: option.maxValue ?? option.max_value ?? null,
    maxLength: option.maxLength ?? option.max_length ?? null,
    // A description is the only hint Discord shows for an option; the modal
    // borrows it rather than leaving the box unexplained.
    example: option.description || null,
  };
}

/**
 * A command that never got a slash version still has to be reachable, so it is
 * offered the way it is used: one line of arguments, with its own usage string as
 * the example of what belongs there.
 *
 * @param {object} command
 */
function argumentLeaf(command) {
  const usage = command.command?.usage || "";
  const subcommands = command.command?.subcommands || [];

  return {
    path: command.name,
    label: command.name,
    description: [
      command.description,
      usage ? `\`${command.name} ${usage}\`` : "",
      subcommands.map((sub) => `\`${sub.trigger}\` — ${sub.description}`).join("\n"),
    ]
      .filter(Boolean)
      .join("\n"),
    subcommand: null,
    group: null,
    prefixOnly: true,
    options: [
      {
        id: "args",
        name: "arguments",
        description: usage || command.description || "",
        emoji: "⌨️",
        type: "text",
        required: (command.command?.minArgsCount || 0) > 0,
        choices: null,
        choiceLabels: {},
        channelTypes: null,
        min: 0,
        max: 999999,
        maxLength: 400,
        example: usage || null,
      },
    ],
  };
}

/**
 * Every way one command can be run.
 *
 * @param {object} command
 * @returns {{path: string, label: string, description: string, subcommand: string|null, group: string|null, options: object[]}[]}
 */
function leavesOf(command) {
  if (!command.slashCommand?.enabled) return [argumentLeaf(command)];

  const options = command.slashCommand?.options || [];
  const subcommands = options.filter((option) => option.type === OPTION.Subcommand);
  const groups = options.filter((option) => option.type === OPTION.SubcommandGroup);

  const describe = (list) => (list || []).map(describeOption).filter(Boolean);

  if (!subcommands.length && !groups.length) {
    return [
      {
        path: command.name,
        label: command.name,
        description: command.description || "",
        subcommand: null,
        group: null,
        options: describe(options),
      },
    ];
  }

  const leaves = subcommands.map((sub) => ({
    path: `${command.name} ${sub.name}`,
    label: `${command.name} ${sub.name}`,
    description: sub.description || "",
    subcommand: sub.name,
    group: null,
    options: describe(sub.options),
  }));

  for (const group of groups) {
    for (const sub of group.options || []) {
      leaves.push({
        path: `${command.name} ${group.name} ${sub.name}`,
        label: `${command.name} ${group.name} ${sub.name}`,
        description: sub.description || "",
        subcommand: sub.name,
        group: group.name,
        options: describe(sub.options),
      });
    }
  }

  return leaves;
}

/**
 * Whether somebody may run this command at all.
 *
 * The panel only offers what the person opening it could run anyway — a member
 * without Ban Members never sees a ban button to be refused by.
 *
 * @param {object} command
 * @param {import('discord.js').GuildMember} member
 * @returns {boolean}
 */
function allowed(command, member) {
  // The panel is how somebody got here; offering it inside itself is noise.
  if (command.name === "panel") return false;
  if (!command.slashCommand?.enabled && !command.command?.enabled) return false;
  if (command.category === "OWNER") return OWNER_IDS.includes(member?.id);
  if (!command.userPermissions?.length) return true;
  return Boolean(member?.permissions?.has(command.userPermissions));
}

/**
 * Every command the bot has, slash or not, deduplicated by name.
 *
 * @param {import('discord.js').Client} client
 */
function allCommands(client) {
  const byName = new Map();
  for (const command of client?.commands || []) if (command?.name) byName.set(command.name, command);
  for (const command of client?.slashCommands?.values?.() || []) byName.set(command.name, command);

  return [...byName.values()];
}

/**
 * @param {import('discord.js').Client} client
 * @param {import('discord.js').GuildMember} member
 * @returns {object[]} commands this member may run, in name order
 */
function commandsFor(client, member) {
  return allCommands(client)
    .filter((command) => allowed(command, member))
    .sort((left, right) => left.name.localeCompare(right.name));
}

/**
 * The categories that have anything in them for this member.
 *
 * @param {import('discord.js').Client} client
 * @param {import('discord.js').GuildMember} member
 * @param {(key: string, vars?: object) => string} [t] names the sections in the
 *   server's language; without it they keep the English ones
 * @returns {{id: string, name: string, emoji: string, count: number}[]}
 */
function categoriesFor(client, member, t) {
  const counted = new Map();
  for (const command of commandsFor(client, member)) {
    counted.set(command.category, (counted.get(command.category) || 0) + 1);
  }

  const named = (id) => {
    const key = `commands.categories.${id}`;
    const translated = t?.(key);
    return translated && translated !== key ? translated : CommandCategory[id]?.name || id;
  };

  return [...counted.entries()]
    .map(([id, count]) => ({ id, name: named(id), emoji: CommandCategory[id]?.emoji || "▫️", count }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

/**
 * @param {import('discord.js').Client} client
 * @param {import('discord.js').GuildMember} member
 * @param {string} category
 * @returns {object[]}
 */
function commandsIn(client, member, category) {
  return commandsFor(client, member).filter((command) => command.category === category);
}

/**
 * Find one runnable leaf by the path the panel put in a custom id.
 *
 * @param {import('discord.js').Client} client
 * @param {import('discord.js').GuildMember} member
 * @param {string} path e.g. "ticket add" or "ban"
 * @returns {{command: object, leaf: object}|null}
 */
function resolve(client, member, path) {
  const [name] = String(path).split(" ");
  const command = allCommands(client).find((entry) => entry.name === name);
  if (!command || !allowed(command, member)) return null;

  const leaf = leavesOf(command).find((entry) => entry.path === path);
  return leaf ? { command, leaf } : null;
}

module.exports = {
  ICONS,
  PAGE,
  PermissionFlagsBits,
  allCommands,
  allowed,
  categoriesFor,
  commandsFor,
  commandsIn,
  describeOption,
  fieldType,
  leavesOf,
  resolve,
};
