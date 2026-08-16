const crypto = require("node:crypto");
const { ApplicationCommandType } = require("discord.js");
const {
  ACTION_TYPES,
  CHOICE_TYPES,
  MAX_ACTIONS,
  MAX_CHOICES,
  MAX_CUSTOM_COMMANDS,
  MAX_MODAL_INPUTS,
  MAX_MODAL_TITLE,
  MAX_OPTIONS,
  MAX_SUBCOMMANDS,
  NAME_PATTERN,
  OPTION_TYPES,
  model,
} = require("@schemas/CustomCommand");
const {
  contextLabel,
  reservedNames,
  syncGuildCommands,
  unpublishCommand,
} = require("@src/services/customCommands/applicationCommands");
const {
  RichMessageError,
  sanitizeButtons,
  sanitizeFields,
  sanitizePoll,
} = require("@src/services/richMessage/RichMessage");
const { resolveComponentEmoji } = require("@helpers/SelfRoles");

class CustomCommandError extends Error {
  constructor(message) {
    super(message);
    this.name = "CustomCommandError";
  }
}

function commandName(value) {
  const name = String(value || "")
    .trim()
    .toLowerCase();
  if (!/^[a-z0-9_-]{1,32}$/.test(name)) {
    throw new CustomCommandError("Use 1-32 lowercase letters, numbers, underscores, or hyphens.");
  }
  return name;
}

function ids(guild, value, kind) {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  const cache = kind === "role" ? guild.roles.cache : guild.channels.cache;
  return [...new Set(values.map(String))].filter((id) => {
    const entry = cache.get(id);
    if (!entry) return false;
    if (kind === "role") return entry.id !== guild.id && !entry.managed;
    return entry.isTextBased?.() && !entry.isThread?.();
  });
}

async function createCommand(guild, input, client, commandModel = model) {
  const name = commandName(input.name);
  if (client.getCommand?.(name)) throw new CustomCommandError("That name belongs to a built-in command.");
  if ((await commandModel.countDocuments({ guild_id: guild.id })) >= MAX_CUSTOM_COMMANDS) {
    throw new CustomCommandError(`A server can have at most ${MAX_CUSTOM_COMMANDS} custom commands.`);
  }
  try {
    return await commandModel.create({
      guild_id: guild.id,
      name,
      description:
        String(input.description || "")
          .trim()
          .slice(0, 100) || null,
      actions: [],
    });
  } catch (error) {
    if (error?.code === 11000) throw new CustomCommandError("A custom command with that name already exists.");
    throw error;
  }
}

async function findCommand(guildId, id, commandModel = model) {
  if (!/^[a-f\d]{24}$/i.test(String(id || ""))) throw new CustomCommandError("Invalid custom command id.");
  const command = await commandModel.findOne({ _id: id, guild_id: guildId });
  if (!command) throw new CustomCommandError("Custom command no longer exists.");
  return command;
}

async function updateCommand(guild, id, input, client, commandModel = model) {
  const command = await findCommand(guild.id, id, commandModel);
  const name = commandName(input.name);
  const builtIn = client.getCommand?.(name);
  if (builtIn) throw new CustomCommandError("That name belongs to a built-in command.");
  command.name = name;
  command.description =
    String(input.description || "")
      .trim()
      .slice(0, 100) || null;
  command.group =
    String(input.group || "CUSTOM")
      .trim()
      .slice(0, 32) || "CUSTOM";
  command.enabled = input.enabled === "on";
  command.delete_invocation = input.deleteInvocation === "on";
  command.cooldown_seconds = Math.min(86400, Math.max(0, Number.parseInt(input.cooldown, 10) || 0));
  command.allowed_roles = ids(guild, input.allowedRoles, "role");
  command.allowed_channels = ids(guild, input.allowedChannels, "channel");
  const triggers = {
    prefix: input.triggerPrefix === "on",
    slash: input.triggerSlash === "on",
    message_context: input.triggerMessageContext === "on",
    member_context: input.triggerMemberContext === "on",
  };
  // A command with every trigger switched off can never run and would be
  // invisible everywhere but this page; the prefix is what it falls back to.
  if (!Object.values(triggers).some(Boolean)) triggers.prefix = true;

  // A form can only ever be shown as the first answer to an interaction, so a
  // command that has one is only reachable through the triggers that give it
  // one - a typed command runs against a plain message, with nothing to open a
  // modal on.
  if (command.actions.some((entry) => entry.type === "SHOW_MODAL")) {
    triggers.prefix = false;
    if (!triggers.slash && !triggers.message_context && !triggers.member_context) {
      throw new CustomCommandError("This command has a form, so it needs a slash or context menu trigger.");
    }
  }
  command.triggers = triggers;

  command.context_label =
    String(input.contextLabel || "")
      .trim()
      .slice(0, 32) || null;

  if (triggers.message_context || triggers.member_context) {
    const label = contextLabel(command);
    const reserved = reservedNames(client);
    if (triggers.message_context && reserved.get(ApplicationCommandType.Message)?.has(label)) {
      throw new CustomCommandError("That context menu label belongs to a built-in entry.");
    }
    if (triggers.member_context && reserved.get(ApplicationCommandType.User)?.has(label)) {
      throw new CustomCommandError("That context menu label belongs to a built-in entry.");
    }
  }

  try {
    await command.save();
  } catch (error) {
    if (error?.code === 11000) throw new CustomCommandError("A custom command with that name already exists.");
    throw error;
  }
  return command;
}

/**
 * One line of a form's field list: `id | label | style | required | min | max | placeholder`.
 * Only the id and the label are required; everything after them is optional and
 * may be left off the line entirely.
 *
 * @param {string} raw
 * @returns {object[]}
 */
function parseModalInputs(raw) {
  const lines = String(raw || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length > MAX_MODAL_INPUTS) {
    throw new CustomCommandError(`A form can have at most ${MAX_MODAL_INPUTS} fields.`);
  }

  const seen = new Set();
  return lines.map((line) => {
    const [rawId, rawLabel, rawStyle, rawRequired, rawMin, rawMax, ...rest] = line
      .split("|")
      .map((part) => part.trim());
    const id = String(rawId || "")
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "")
      .slice(0, 100);
    const label = String(rawLabel || "").slice(0, 45);
    if (!id || !label) {
      throw new CustomCommandError('Each field needs an id and a label, e.g. "color | Favourite colour | short".');
    }
    if (seen.has(id)) throw new CustomCommandError(`Field id "${id}" is used twice.`);
    seen.add(id);

    const style = String(rawStyle || "")
      .trim()
      .toLowerCase()
      .startsWith("p")
      ? "PARAGRAPH"
      : "SHORT";
    const required =
      String(rawRequired || "required")
        .trim()
        .toLowerCase() !== "optional";

    const min = rawMin ? Number.parseInt(rawMin, 10) : null;
    const max = rawMax ? Number.parseInt(rawMax, 10) : null;
    if (rawMin && !Number.isFinite(min)) throw new CustomCommandError(`"${rawMin}" is not a valid minimum length.`);
    if (rawMax && !Number.isFinite(max)) throw new CustomCommandError(`"${rawMax}" is not a valid maximum length.`);
    if (min !== null && max !== null && min > max) {
      throw new CustomCommandError(`Field "${id}": the minimum length cannot exceed the maximum.`);
    }

    return {
      id,
      label,
      style,
      required,
      min_length: min !== null ? Math.min(4000, Math.max(0, min)) : null,
      max_length: max !== null ? Math.min(4000, Math.max(1, max)) : null,
      placeholder: rest.join("|").trim().slice(0, 100) || null,
    };
  });
}

/**
 * @param {import('discord.js').Guild} guild
 * @param {object} input
 * @param {object} [command] the command this action is joining, so a form can
 *   be refused when nothing could ever show it and can offer the command's
 *   other actions as its confirmation step
 */
function actionFromInput(guild, input, command = { actions: [], triggers: {} }) {
  const type = ACTION_TYPES.includes(input.type) ? input.type : "SEND_MESSAGE";
  const name =
    String(input.actionName || "")
      .trim()
      .slice(0, 80) || type.toLowerCase().replaceAll("_", " ");

  if (type === "SHOW_MODAL") {
    if ((command.actions || []).some((entry) => entry.type === "SHOW_MODAL")) {
      throw new CustomCommandError("A command can only have one form.");
    }
    if (!command.triggers?.slash && !command.triggers?.message_context && !command.triggers?.member_context) {
      throw new CustomCommandError(
        "Enable a slash or context menu trigger before adding a form - Discord cannot open a form from a typed command."
      );
    }
    const modalTitle = String(input.modalTitle || "")
      .trim()
      .slice(0, MAX_MODAL_TITLE);
    if (!modalTitle) throw new CustomCommandError("A form needs a title.");
    const modalInputs = parseModalInputs(input.modalInputs);
    if (!modalInputs.length) throw new CustomCommandError("A form needs at least one field.");
    const confirmActionId = (command.actions || []).find((entry) => entry.id === input.confirmAction)?.id || null;

    return {
      id: crypto.randomUUID(),
      name,
      type,
      modal_title: modalTitle,
      modal_inputs: modalInputs,
      confirm_action_id: confirmActionId,
    };
  }

  if (type === "CHANGE_ROLES") {
    const addRoles = ids(guild, input.addRoles, "role");
    const removeRoles = ids(guild, input.removeRoles, "role").filter((id) => !addRoles.includes(id));
    if (!addRoles.length && !removeRoles.length) throw new CustomCommandError("Choose a role to add or remove.");
    return { id: crypto.randomUUID(), name, type, add_roles: addRoles, remove_roles: removeRoles };
  }

  if (type === "ADD_REACTION") {
    try {
      const emoji = resolveComponentEmoji(String(input.emoji || "").trim(), guild);
      if (!emoji) throw new Error("missing emoji");
      return { id: crypto.randomUUID(), name, type, emoji };
    } catch {
      throw new CustomCommandError("Choose one Unicode emoji or an emoji from this server.");
    }
  }

  const trimmed = (value, max) =>
    String(value || "")
      .trim()
      .slice(0, max) || null;
  const httpsOrNull = (value) => {
    const value_ = String(value || "").trim();
    return /^https:\/\//i.test(value_) ? value_.slice(0, 300) : null;
  };

  const content = trimmed(input.content, 2000);
  const embedTitle = trimmed(input.embedTitle, 256);
  const embedDescription = trimmed(input.embedDescription, 4096);
  const embedAuthor = trimmed(input.embedAuthor, 256);
  const embedFooter = trimmed(input.embedFooter, 2048);
  const embedThumbnail = httpsOrNull(input.embedThumbnail);
  const embedImage = httpsOrNull(input.embedImage);
  const color = /^#[0-9a-f]{6}$/i.test(String(input.embedColor || "")) ? input.embedColor : null;
  const channelId = ids(guild, input.channelId, "channel")[0] || null;

  let poll = null;
  try {
    poll = type === "SEND_MESSAGE" ? sanitizePoll(input) : null;
  } catch (error) {
    if (error instanceof RichMessageError) throw new CustomCommandError(error.message);
    throw error;
  }

  let fields = [];
  let buttons = [];
  try {
    fields = sanitizeFields(input.fields);
    buttons = sanitizeButtons(input.buttons);
  } catch (error) {
    if (error instanceof RichMessageError) throw new CustomCommandError(error.message);
    throw error;
  }

  // A poll is the whole message on its own; the rest of the rich-message
  // fields would never be looked at once it is running, so a form that filled
  // them in too is told rather than having them quietly ignored.
  if (poll && (content || embedTitle || embedDescription || fields.length || buttons.length)) {
    throw new CustomCommandError("A poll replaces the message - remove the text and embed fields, or the poll.");
  }
  if (!poll && !content && !embedTitle && !embedDescription) {
    throw new CustomCommandError("Add message text, embed content, or a poll.");
  }

  return {
    id: crypto.randomUUID(),
    name,
    type,
    content,
    embed_title: embedTitle,
    embed_description: embedDescription,
    embed_color: color,
    embed_author: embedAuthor,
    embed_footer: embedFooter,
    embed_thumbnail: embedThumbnail,
    embed_image: embedImage,
    embed_timestamp: input.embedTimestamp === "on",
    fields,
    buttons,
    poll,
    channel_id: type === "SEND_MESSAGE" ? channelId : null,
    tts: input.tts === "on",
    delete_after_seconds: Math.min(86400, Math.max(0, Number.parseInt(input.deleteAfterSeconds, 10) || 0)),
    mention_roles: ids(guild, input.mentionRoles, "role"),
  };
}

async function addAction(guild, commandId, input, commandModel = model) {
  const command = await findCommand(guild.id, commandId, commandModel);
  if (command.actions.length >= MAX_ACTIONS)
    throw new CustomCommandError(`A command can have at most ${MAX_ACTIONS} actions.`);
  command.actions.push(actionFromInput(guild, input, command));
  await command.save();
  return command;
}

async function deleteAction(guildId, commandId, actionId, commandModel = model) {
  const command = await findCommand(guildId, commandId, commandModel);
  const before = command.actions.length;
  command.actions = command.actions.filter((action) => action.id !== actionId);
  if (command.actions.length === before) throw new CustomCommandError("Action no longer exists.");
  await command.save();
  return command;
}

/**
 * The published entries come down before the document does: once it is gone
 * nothing records what it registered, and the entries would be left in Discord
 * with nothing behind them.
 *
 * @param {import('discord.js').Guild} guild
 * @param {string} id
 * @param {object} [logger]
 */
async function deleteCommand(guild, id, logger, commandModel = model) {
  const command = await findCommand(guild.id, id, commandModel);
  await unpublishCommand(guild, command, logger);
  const result = await commandModel.deleteOne({ _id: command._id, guild_id: guild.id });
  if (!result.deletedCount) throw new CustomCommandError("Custom command no longer exists.");
  return command;
}

/* ------------------------------------------------- slash command parameters */

/**
 * The choice list of one parameter, written as one `label = value` per line.
 *
 * @param {string} raw
 * @param {number} type the Discord option type the choices belong to
 * @returns {{name: string, value: string}[]}
 */
function parseChoices(raw, type) {
  if (!CHOICE_TYPES.includes(type)) return [];

  const choices = String(raw || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, MAX_CHOICES)
    .map((line) => {
      const [label, ...rest] = line.split("=");
      const value = (rest.join("=") || label).trim();
      return { name: label.trim().slice(0, 100), value: value.slice(0, 100) };
    })
    .filter((choice) => choice.name && choice.value);

  // Discord rejects the whole command when a numeric option offers a choice
  // that is not a number, so the bad line is dropped rather than the command.
  if (type === OPTION_TYPES.STRING) return choices;
  return choices.filter((choice) => Number.isFinite(Number(choice.value)));
}

/**
 * One parameter, as the dashboard form describes it.
 *
 * @param {object} input
 * @returns {object}
 */
function optionFromInput(input) {
  const name = String(input.optionName || "")
    .trim()
    .toLowerCase();
  if (!NAME_PATTERN.test(name)) {
    throw new CustomCommandError("Use 1-32 lowercase letters, numbers, underscores, or hyphens for a parameter name.");
  }

  const type = Number.parseInt(input.optionType, 10);
  if (!Object.values(OPTION_TYPES).includes(type)) throw new CustomCommandError("Choose a parameter type.");

  const description =
    String(input.optionDescription || "")
      .trim()
      .slice(0, 100) || name;

  return {
    name,
    description,
    type,
    required: input.optionRequired === "on",
    choices: parseChoices(input.choices, type),
  };
}

/**
 * Where a parameter belongs: the command itself, or one of its subcommands.
 *
 * Discord takes one or the other and rejects a command carrying both, so the
 * two lists are kept mutually exclusive here rather than at publication time.
 *
 * @param {object} command
 * @param {string} [subcommandName]
 */
function optionHost(command, subcommandName) {
  if (!subcommandName) {
    if (command.subcommands.length) {
      throw new CustomCommandError("A command with subcommands cannot also take parameters of its own.");
    }
    return command.options;
  }

  const subcommand = command.subcommands.find((entry) => entry.name === String(subcommandName).toLowerCase());
  if (!subcommand) throw new CustomCommandError("Subcommand no longer exists.");
  return subcommand.options;
}

async function addOption(guildId, commandId, input, commandModel = model) {
  const command = await findCommand(guildId, commandId, commandModel);
  const option = optionFromInput(input);
  const host = optionHost(command, input.subcommand);

  if (host.length >= MAX_OPTIONS) throw new CustomCommandError(`A command can have at most ${MAX_OPTIONS} parameters.`);
  if (host.some((entry) => entry.name === option.name)) {
    throw new CustomCommandError("A parameter with that name already exists here.");
  }
  // Discord requires every required option before every optional one.
  if (option.required) host.splice(host.filter((entry) => entry.required).length, 0, option);
  else host.push(option);

  await command.save();
  return command;
}

async function deleteOption(guildId, commandId, name, subcommandName, commandModel = model) {
  const command = await findCommand(guildId, commandId, commandModel);
  const host = optionHost(command, subcommandName);
  const index = host.findIndex((entry) => entry.name === String(name).toLowerCase());
  if (index === -1) throw new CustomCommandError("Parameter no longer exists.");
  host.splice(index, 1);
  await command.save();
  return command;
}

async function addSubcommand(guildId, commandId, input, commandModel = model) {
  const command = await findCommand(guildId, commandId, commandModel);
  if (command.options.length) {
    throw new CustomCommandError("A command with parameters of its own cannot also have subcommands.");
  }
  if (command.subcommands.length >= MAX_SUBCOMMANDS) {
    throw new CustomCommandError(`A command can have at most ${MAX_SUBCOMMANDS} subcommands.`);
  }

  const name = String(input.subcommandName || "")
    .trim()
    .toLowerCase();
  if (!NAME_PATTERN.test(name)) {
    throw new CustomCommandError("Use 1-32 lowercase letters, numbers, underscores, or hyphens for a subcommand name.");
  }
  if (command.subcommands.some((entry) => entry.name === name)) {
    throw new CustomCommandError("A subcommand with that name already exists.");
  }

  command.subcommands.push({
    name,
    description:
      String(input.subcommandDescription || "")
        .trim()
        .slice(0, 100) || name,
    options: [],
  });
  await command.save();
  return command;
}

async function deleteSubcommand(guildId, commandId, name, commandModel = model) {
  const command = await findCommand(guildId, commandId, commandModel);
  const before = command.subcommands.length;
  command.subcommands = command.subcommands.filter((entry) => entry.name !== String(name).toLowerCase());
  if (command.subcommands.length === before) throw new CustomCommandError("Subcommand no longer exists.");
  await command.save();
  return command;
}

/* ---------------------------------------------------------------- publishing */

/**
 * Bring the guild's published commands in line with what it now has stored.
 *
 * Called after every change that could alter what Discord should be showing,
 * including deleting a command — its entries have to come down with it.
 *
 * @param {import('discord.js').Guild} guild
 * @param {object} [logger]
 * @param {object} [commandModel]
 */
async function publishCommands(guild, logger, commandModel = model) {
  const commands = await commandModel.find({ guild_id: guild.id }).sort({ name: 1 });
  return syncGuildCommands({ guild, commands, logger });
}

module.exports = {
  CustomCommandError,
  actionFromInput,
  addAction,
  addOption,
  addSubcommand,
  commandName,
  createCommand,
  deleteAction,
  deleteCommand,
  deleteOption,
  deleteSubcommand,
  findCommand,
  listCommands: (guildId) => model.find({ guild_id: guildId }).sort({ name: 1 }).lean(),
  optionFromInput,
  optionHost,
  parseChoices,
  parseModalInputs,
  publishCommands,
  updateCommand,
};
