const { ApplicationCommandType } = require("discord.js");
const { CHOICE_TYPES, MAX_CHOICES, MAX_OPTIONS, MAX_SUBCOMMANDS } = require("@schemas/CustomCommand");

/**
 * Publishing a server's own commands to Discord.
 *
 * A custom command can be typed after the prefix, run as a slash command, or
 * picked from the right-click menu on a message or a member. The last three have
 * to exist in Discord before they can be picked, so they are published as guild
 * application commands.
 *
 * The synchronisation is deliberately not `guild.commands.set()`. That call
 * replaces every application command the guild has, and the bot's own commands
 * are registered per guild whenever it runs without global registration — one
 * save from the dashboard would have wiped all of them. Instead each command
 * remembers what it published, and only those entries are ever created, edited
 * or deleted. Anything the bot did not put there is left alone.
 */

const SUBCOMMAND_TYPE = 1;

/**
 * @param {object} option stored option
 * @returns {object} the option as Discord takes it
 */
function optionPayload(option) {
  const payload = {
    name: option.name,
    description: option.description,
    type: option.type,
    required: Boolean(option.required),
  };

  if (CHOICE_TYPES.includes(option.type) && option.choices?.length) {
    payload.choices = option.choices.slice(0, MAX_CHOICES).map((choice) => ({
      name: choice.name,
      // Discord types a choice's value the same way as its option. An integer
      // option offered a string here is rejected for the whole command.
      value: option.type === 3 ? String(choice.value) : Number(choice.value),
    }));
  }

  return payload;
}

/**
 * The chat-input command for one custom command: either its root parameters or
 * its subcommands, never both — Discord rejects a command that carries both.
 *
 * @param {object} command
 * @returns {object}
 */
function chatInputPayload(command) {
  const subcommands = (command.subcommands || []).slice(0, MAX_SUBCOMMANDS);
  const options = subcommands.length
    ? subcommands.map((subcommand) => ({
        name: subcommand.name,
        description: subcommand.description,
        type: SUBCOMMAND_TYPE,
        options: (subcommand.options || []).slice(0, MAX_OPTIONS).map(optionPayload),
      }))
    : (command.options || []).slice(0, MAX_OPTIONS).map(optionPayload);

  return {
    name: command.name,
    // Discord insists on a description, and an empty one fails the whole
    // registration rather than the one field.
    description: String(command.description || `Custom command ${command.name}`).slice(0, 100),
    type: ApplicationCommandType.ChatInput,
    options,
  };
}

/**
 * The context-menu label. It is shown rather than typed, so it keeps whatever
 * the dashboard was given, falling back to the command's own name.
 *
 * @param {object} command
 * @returns {string}
 */
function contextLabel(command) {
  return String(command.context_label || command.name).slice(0, 32);
}

/**
 * Everything this command should exist as in Discord right now.
 *
 * A disabled command wants nothing published, which is what takes its entries
 * down again on the next synchronisation.
 *
 * @param {object} command
 * @returns {{key: string, type: number, name: string, payload: object}[]}
 */
function desiredRegistrations(command) {
  if (!command?.enabled) return [];

  const wanted = [];
  if (command.triggers?.slash) {
    const payload = chatInputPayload(command);
    wanted.push({
      key: `${ApplicationCommandType.ChatInput}:${payload.name}`,
      type: payload.type,
      name: payload.name,
      payload,
    });
  }

  for (const [flag, type] of [
    ["message_context", ApplicationCommandType.Message],
    ["member_context", ApplicationCommandType.User],
  ]) {
    if (!command.triggers?.[flag]) continue;
    const payload = { name: contextLabel(command), type };
    wanted.push({ key: `${type}:${payload.name}`, type, name: payload.name, payload });
  }

  return wanted;
}

/**
 * Whether Discord already holds exactly this, so an unchanged command costs no
 * API call at all.
 *
 * @param {object} existing an ApplicationCommand from the guild cache
 * @param {object} payload
 * @returns {boolean}
 */
function matchesExisting(existing, payload) {
  if (!existing) return false;
  if (existing.type !== payload.type) return false;
  if (existing.name !== payload.name) return false;
  if (payload.type !== ApplicationCommandType.ChatInput) return true;
  if ((existing.description || "") !== payload.description) return false;

  const normalise = (options) =>
    JSON.stringify(
      (options || []).map((option) => ({
        name: option.name,
        description: option.description || "",
        type: option.type,
        required: Boolean(option.required),
        choices: (option.choices || []).map((choice) => [choice.name, String(choice.value)]),
        options: (option.options || []).map((child) => ({
          name: child.name,
          description: child.description || "",
          type: child.type,
          required: Boolean(child.required),
          choices: (child.choices || []).map((choice) => [choice.name, String(choice.value)]),
        })),
      }))
    );

  return normalise(existing.options) === normalise(payload.options);
}

/**
 * Names the bot's own commands hold, which a custom command may not take.
 *
 * A guild command shadows a global one of the same name, so a custom command
 * allowed to reuse a built-in name would quietly replace it for that server.
 *
 * @param {import('discord.js').Client} client
 * @returns {Map<string, Set<string>>} keyed by application command type
 */
function reservedNames(client) {
  const reserved = new Map([
    [ApplicationCommandType.ChatInput, new Set()],
    [ApplicationCommandType.Message, new Set()],
    [ApplicationCommandType.User, new Set()],
  ]);

  for (const command of client?.slashCommands?.values?.() || []) {
    reserved.get(ApplicationCommandType.ChatInput).add(command.name);
  }
  for (const command of client?.commands || []) {
    if (command?.name) reserved.get(ApplicationCommandType.ChatInput).add(command.name);
  }
  for (const context of client?.contextMenus?.values?.() || []) {
    reserved.get(context.type)?.add(context.name);
  }

  return reserved;
}

/**
 * Bring one guild's published commands in line with what its custom commands
 * ask for.
 *
 * Nothing here throws: Discord refusing one command must not stop the rest, and
 * must never take down the process. Every refusal is reported back instead.
 *
 * @param {Object} input
 * @param {import('discord.js').Guild} input.guild
 * @param {object[]} input.commands the guild's custom command documents
 * @param {object} [input.logger]
 * @returns {Promise<{created: string[], updated: string[], removed: string[], conflicts: string[], failed: string[]}>}
 */
async function syncGuildCommands({ guild, commands, logger }) {
  const result = { created: [], updated: [], removed: [], conflicts: [], failed: [] };
  if (!guild?.commands) return result;

  const reserved = reservedNames(guild.client);
  const published = await guild.commands.fetch().catch((error) => {
    logger?.warn?.(`custom commands: could not read published commands for ${guild.id}: ${error.message}`);
    return null;
  });
  if (!published) {
    result.failed.push("fetch");
    return result;
  }

  // Two custom commands asking for the same name would fight over one entry on
  // every save. The first one wins and the other is reported.
  const claimed = new Set();

  for (const command of commands) {
    const keep = [];
    const wanted = [];

    for (const entry of desiredRegistrations(command)) {
      if (reserved.get(entry.type)?.has(entry.name) || claimed.has(entry.key)) {
        result.conflicts.push(`${command.name}: ${entry.name}`);
        continue;
      }
      claimed.add(entry.key);
      wanted.push(entry);
    }

    const registrations = [...(command.registrations || [])];

    for (const entry of wanted) {
      const previous = registrations.find((item) => item.type === entry.type && item.name === entry.name);
      const existing = previous ? published.get(previous.command_id) : null;

      try {
        if (existing && matchesExisting(existing, entry.payload)) {
          keep.push({ type: entry.type, name: entry.name, command_id: existing.id });
          continue;
        }
        if (existing) {
          const edited = await existing.edit(entry.payload);
          keep.push({ type: entry.type, name: entry.name, command_id: edited.id });
          result.updated.push(entry.name);
          continue;
        }
        const created = await guild.commands.create(entry.payload);
        keep.push({ type: entry.type, name: entry.name, command_id: created.id });
        result.created.push(entry.name);
      } catch (error) {
        // Discord refusing an edit is not a reason to take a working command
        // down: what was already published stays, and the next save tries again.
        if (existing) keep.push({ type: entry.type, name: entry.name, command_id: existing.id });
        logger?.warn?.(`custom commands: ${guild.id}/${command.name} refused by Discord: ${error.message}`);
        result.failed.push(entry.name);
      }
    }

    // Whatever this command published before and no longer wants comes down,
    // and only that: an id it never wrote is never touched.
    for (const previous of registrations) {
      if (keep.some((item) => item.command_id === previous.command_id)) continue;
      const existing = published.get(previous.command_id);
      if (!existing) continue;
      try {
        await existing.delete();
        result.removed.push(previous.name);
      } catch (error) {
        logger?.warn?.(`custom commands: could not remove ${previous.name} in ${guild.id}: ${error.message}`);
        result.failed.push(previous.name);
      }
    }

    const asText = (list) => JSON.stringify([...list].map((item) => [item.type, item.name, item.command_id]).sort());
    const changed = asText(registrations) !== asText(keep);
    if (changed && typeof command.save === "function") {
      command.registrations = keep;
      await command.save().catch((error) => {
        logger?.error?.(`custom commands: could not record registrations for ${command.name}`, error);
      });
    }
  }

  return result;
}

/**
 * Take down everything one command published, before the command itself goes.
 *
 * A deleted document can no longer say what it registered, so this has to run
 * first — otherwise the entries stay in Discord with nothing behind them.
 *
 * @param {import('discord.js').Guild} guild
 * @param {object} command
 * @param {object} [logger]
 * @returns {Promise<string[]>} the names actually removed
 */
async function unpublishCommand(guild, command, logger) {
  const removed = [];
  for (const registration of command?.registrations || []) {
    try {
      await guild.commands.delete(registration.command_id);
      removed.push(registration.name);
    } catch (error) {
      // Already gone from Discord's side is the outcome we wanted anyway.
      logger?.warn?.(`custom commands: could not remove ${registration.name} in ${guild.id}: ${error.message}`);
    }
  }
  return removed;
}

module.exports = {
  SUBCOMMAND_TYPE,
  unpublishCommand,
  chatInputPayload,
  contextLabel,
  desiredRegistrations,
  matchesExisting,
  optionPayload,
  reservedNames,
  syncGuildCommands,
};
