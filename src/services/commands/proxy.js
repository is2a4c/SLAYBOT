/**
 * Running a real command from a panel click.
 *
 * A command reads what it was given through `interaction.options` and answers
 * through the interaction itself. Both of those work the same whether the
 * interaction came from typing a slash command or from pressing a button, so the
 * panel hands the command the button's interaction with one thing replaced: the
 * options, built from the form instead of from what somebody typed.
 *
 * Nothing about the command changes, and a command written tomorrow is runnable
 * from the panel the day it is added.
 */

/**
 * The `interaction.options` a command expects, answered from a filled-in form.
 *
 * @param {Object} input
 * @param {object[]} input.options what the leaf declares it takes
 * @param {object} input.values what the form was filled in with
 * @param {string|null} input.subcommand
 * @param {string|null} input.group
 * @param {import('discord.js').Guild} input.guild
 * @returns {object}
 */
function buildOptions({ options, values, subcommand, group, guild }) {
  const declared = new Map(options.map((option) => [option.id, option]));
  const raw = (name) => (Object.prototype.hasOwnProperty.call(values, name) ? values[name] : null);

  const asNumber = (name) => {
    const value = raw(name);
    if (value === null || value === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const fromCache = (name, cache) => {
    const id = raw(name);
    return id ? cache?.get?.(id) || null : null;
  };

  return {
    /**
     * discord.js throws when a required subcommand is missing, and a command that
     * asks for one cannot carry on without it.
     */
    getSubcommand(required = true) {
      if (!subcommand && required) throw new TypeError("This command has no subcommand");
      return subcommand ?? null;
    },
    getSubcommandGroup(required = false) {
      if (!group && required) throw new TypeError("This command has no subcommand group");
      return group ?? null;
    },
    getString: (name) => {
      const value = raw(name);
      return value === null || value === undefined ? null : String(value);
    },
    getInteger: (name) => {
      const value = asNumber(name);
      return value === null ? null : Math.trunc(value);
    },
    getNumber: asNumber,
    getBoolean: (name) => {
      const value = raw(name);
      return typeof value === "boolean" ? value : null;
    },
    getUser: (name) => fromCache(name, guild?.client?.users?.cache) || fromCache(name, guild?.members?.cache)?.user,
    getMember: (name) => fromCache(name, guild?.members?.cache),
    getChannel: (name) => fromCache(name, guild?.channels?.cache),
    getRole: (name) => fromCache(name, guild?.roles?.cache),
    getMentionable: (name) => fromCache(name, guild?.members?.cache) || fromCache(name, guild?.roles?.cache),
    getAttachment: () => null,
    get: (name) => {
      const option = declared.get(name);
      const value = raw(name);
      return option && value !== null ? { name, type: option.type, value } : null;
    },
    // Some commands walk the raw list to see what they were given.
    get data() {
      return [...declared.keys()].filter((name) => raw(name) !== null).map((name) => ({ name, value: raw(name) }));
    },
  };
}

/**
 * The interaction to hand the command: the real one, answering as itself, with
 * the form's options in place of the typed ones.
 *
 * @param {import('discord.js').Interaction} interaction the click that ran it
 * @param {Object} context
 * @param {string} context.commandName
 * @param {object} context.options
 * @returns {import('discord.js').ChatInputCommandInteraction}
 */
function asCommandInteraction(interaction, { commandName, options }) {
  return new Proxy(interaction, {
    get(target, property, receiver) {
      if (property === "options") return options;
      if (property === "commandName") return commandName;
      // A command may check what it is dealing with; it is running as a command.
      if (property === "isChatInputCommand" || property === "isCommand") return () => true;
      if (property === "isButton" || property === "isStringSelectMenu" || property === "isModalSubmit")
        return () => false;

      const value = Reflect.get(target, property, receiver);
      // Methods have to keep talking to the real interaction, not to the proxy.
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

module.exports = { asCommandInteraction, buildOptions };
