const crypto = require("node:crypto");
const { MAX_ACTIONS, MAX_CUSTOM_COMMANDS, model } = require("@schemas/CustomCommand");
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

async function createCommand(guild, input, actorId, client, commandModel = model) {
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
      created_by: actorId,
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
  try {
    await command.save();
  } catch (error) {
    if (error?.code === 11000) throw new CustomCommandError("A custom command with that name already exists.");
    throw error;
  }
  return command;
}

function actionFromInput(guild, input) {
  const type = ["SEND_MESSAGE", "SEND_DM", "CHANGE_ROLES", "ADD_REACTION"].includes(input.type)
    ? input.type
    : "SEND_MESSAGE";
  const name =
    String(input.actionName || "")
      .trim()
      .slice(0, 80) || type.toLowerCase().replaceAll("_", " ");
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

  const content =
    String(input.content || "")
      .trim()
      .slice(0, 2000) || null;
  const embedTitle =
    String(input.embedTitle || "")
      .trim()
      .slice(0, 256) || null;
  const embedDescription =
    String(input.embedDescription || "")
      .trim()
      .slice(0, 4096) || null;
  if (!content && !embedTitle && !embedDescription) throw new CustomCommandError("Add message text or embed content.");
  const color = /^#[0-9a-f]{6}$/i.test(String(input.embedColor || "")) ? input.embedColor : null;
  const channelId = ids(guild, input.channelId, "channel")[0] || null;
  return {
    id: crypto.randomUUID(),
    name,
    type,
    content,
    embed_title: embedTitle,
    embed_description: embedDescription,
    embed_color: color,
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
  command.actions.push(actionFromInput(guild, input));
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

async function deleteCommand(guildId, id, commandModel = model) {
  if (!/^[a-f\d]{24}$/i.test(String(id || ""))) throw new CustomCommandError("Invalid custom command id.");
  const result = await commandModel.deleteOne({ _id: id, guild_id: guildId });
  if (!result.deletedCount) throw new CustomCommandError("Custom command no longer exists.");
}

module.exports = {
  CustomCommandError,
  actionFromInput,
  addAction,
  commandName,
  createCommand,
  deleteAction,
  deleteCommand,
  findCommand,
  listCommands: (guildId) => model.find({ guild_id: guildId }).sort({ name: 1 }).lean(),
  updateCommand,
};
