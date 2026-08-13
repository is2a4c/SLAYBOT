const { EmbedBuilder } = require("discord.js");
const { model } = require("@schemas/CustomCommand");

const cooldowns = new Map();

function renderTemplate(value, context) {
  return String(value || "")
    .replaceAll("{server}", context.guild.name)
    .replaceAll("{member:id}", context.member.id)
    .replaceAll("{member:name}", context.member.displayName)
    .replaceAll("{member:mention}", `<@${context.member.id}>`)
    .replaceAll("{channel}", `<#${context.channel.id}>`)
    .replaceAll("{arguments}", context.arguments.join(" "));
}

function accessProblem(command, message) {
  if (command.allowed_channels?.length && !command.allowed_channels.includes(message.channelId)) {
    return "This custom command is not available in this channel.";
  }
  if (
    command.allowed_roles?.length &&
    !command.allowed_roles.some((roleId) => message.member.roles.cache.has(roleId))
  ) {
    return "You do not have a role allowed to use this custom command.";
  }
  const key = `${message.guildId}:${command._id}:${message.author.id}`;
  const remaining = (cooldowns.get(key) || 0) - Date.now();
  if (remaining > 0) return `This custom command is on cooldown for ${Math.ceil(remaining / 1000)} seconds.`;
  return null;
}

function messagePayload(action, context) {
  const content = renderTemplate(action.content, context).slice(0, 2000) || null;
  const title = renderTemplate(action.embed_title, context).slice(0, 256) || null;
  const description = renderTemplate(action.embed_description, context).slice(0, 4096) || null;
  const embeds = [];
  if (title || description) {
    const embed = new EmbedBuilder();
    if (title) embed.setTitle(title);
    if (description) embed.setDescription(description);
    if (/^#[0-9a-f]{6}$/i.test(action.embed_color || "")) embed.setColor(action.embed_color);
    embeds.push(embed);
  }
  if (!content && !embeds.length) return null;
  return {
    content,
    embeds,
    tts: Boolean(action.tts),
    allowedMentions: { users: [context.member.id], roles: action.mention_roles || [], parse: [] },
  };
}

function scheduleDeletion(sent, seconds) {
  const delay = Math.min(86400, Math.max(0, Number(seconds) || 0));
  if (!sent?.delete || !delay) return;
  setTimeout(() => sent.delete().catch(() => {}), delay * 1000).unref?.();
}

async function executeSendMessage(action, message, context) {
  const channel = action.channel_id ? message.guild.channels.cache.get(action.channel_id) : message.channel;
  if (!channel?.isTextBased?.()) return;
  const payload = messagePayload(action, context);
  if (payload) {
    const sent = await channel.send(payload);
    scheduleDeletion(sent, action.delete_after_seconds);
  }
}

async function executeSendDm(action, message, context) {
  const payload = messagePayload(action, context);
  if (!payload) return;
  const sent = await message.member.send(payload).catch(() => null);
  scheduleDeletion(sent, action.delete_after_seconds);
}

async function executeAddReaction(action, message) {
  if (action.emoji) await message.react(action.emoji).catch(() => {});
}

function manageableRoles(member, ids) {
  return [...new Set(ids || [])].filter((id) => {
    const role = member.guild.roles.cache.get(id);
    return role && role.id !== member.guild.id && !role.managed && role.editable !== false;
  });
}

async function executeChangeRoles(action, message) {
  const add = manageableRoles(message.member, action.add_roles);
  const remove = manageableRoles(message.member, action.remove_roles).filter((id) => !add.includes(id));
  if (remove.length) await message.member.roles.remove(remove, "SLAYBOT custom command");
  if (add.length) await message.member.roles.add(add, "SLAYBOT custom command");
}

async function executeCommand(command, message, args) {
  const problem = accessProblem(command, message);
  if (problem) {
    await message.safeReply(problem);
    return { handled: true, executed: false };
  }

  const context = { guild: message.guild, channel: message.channel, member: message.member, arguments: args };
  for (const action of command.actions || []) {
    if (action.type === "SEND_MESSAGE") await executeSendMessage(action, message, context);
    if (action.type === "SEND_DM") await executeSendDm(action, message, context);
    if (action.type === "CHANGE_ROLES") await executeChangeRoles(action, message);
    if (action.type === "ADD_REACTION") await executeAddReaction(action, message);
  }

  if (command.delete_invocation && message.deletable) await message.delete().catch(() => {});
  if (command.cooldown_seconds > 0) {
    cooldowns.set(
      `${message.guildId}:${command._id}:${message.author.id}`,
      Date.now() + command.cooldown_seconds * 1000
    );
  }
  return { handled: true, executed: true };
}

async function tryCustomCommand(message, settings, dependencies = {}) {
  if (!settings?.control_center?.common?.text_commands) return { handled: false };
  const content = String(message.content || "");
  if (!content.startsWith(settings.prefix)) return { handled: false };
  const [invoke, ...args] = content.slice(settings.prefix.length).trim().split(/\s+/);
  if (!invoke) return { handled: false };
  const command = await (dependencies.model || model).findOne({
    guild_id: message.guildId,
    name: invoke.toLowerCase(),
    enabled: true,
  });
  if (!command) return { handled: false };
  return executeCommand(command, message, args);
}

module.exports = {
  accessProblem,
  executeCommand,
  executeAddReaction,
  executeSendDm,
  manageableRoles,
  messagePayload,
  renderTemplate,
  scheduleDeletion,
  tryCustomCommand,
};
