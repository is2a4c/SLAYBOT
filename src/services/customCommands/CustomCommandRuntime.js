const { EmbedBuilder } = require("discord.js");
const { model } = require("@schemas/CustomCommand");
const { contextLabel } = require("./applicationCommands");
const { asMessage } = require("@src/services/commands/message");

const cooldowns = new Map();

/**
 * The variables a custom command may use.
 *
 * Every one of them is a name substituted for a value. There is deliberately no
 * expression, no call and no code: a server administrator writing a message must
 * not be able to make the bot run something.
 *
 * @param {string} value
 * @param {object} context
 * @returns {string}
 */
function renderTemplate(value, context) {
  let text = String(value || "")
    .replaceAll("{server}", context.guild.name)
    .replaceAll("{member:id}", context.member.id)
    .replaceAll("{member:name}", context.member.displayName)
    .replaceAll("{member:mention}", `<@${context.member.id}>`)
    .replaceAll("{channel}", `<#${context.channel.id}>`)
    .replaceAll("{arguments}", context.arguments.join(" "));

  const target = context.target;
  text = text
    .replaceAll("{target:id}", target?.id || "")
    .replaceAll("{target:name}", target?.name || "")
    .replaceAll("{target:mention}", target?.id ? `<@${target.id}>` : "")
    .replaceAll("{target:content}", target?.content || "");

  // Named parameters of a slash command, by the name the dashboard gave them.
  for (const [name, given] of Object.entries(context.options || {})) {
    text = text.replaceAll(`{option:${name}}`, String(given ?? ""));
  }

  return text;
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
  // A slash or context invocation has no message to react to; the rest of the
  // command still runs rather than failing on the one action that cannot.
  if (action.emoji && typeof message.react === "function") await message.react(action.emoji).catch(() => {});
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

async function executeCommand(command, message, args, extra = {}) {
  const problem = accessProblem(command, message);
  if (problem) {
    await message.safeReply(problem);
    return { handled: true, executed: false };
  }

  const context = {
    guild: message.guild,
    channel: message.channel,
    member: message.member,
    arguments: args,
    target: extra.target || null,
    options: extra.options || {},
  };
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

/**
 * What a slash invocation was filled in with, by option name, plus the same
 * values as the words a prefix invocation would have carried.
 *
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @returns {{args: string[], options: Record<string, string>, subcommand: string|null}}
 */
function readSlashOptions(interaction) {
  const subcommand = interaction.options?.getSubcommand?.(false) || null;
  const given = interaction.options?.data || [];
  const flat = subcommand ? given.flatMap((entry) => entry.options || []) : given;

  const options = {};
  for (const entry of flat) {
    options[entry.name] = entry.value === undefined || entry.value === null ? "" : String(entry.value);
  }

  return {
    subcommand,
    options,
    args: [subcommand, ...Object.values(options)].filter((value) => value !== null && value !== ""),
  };
}

/**
 * Answer the interaction ourselves when nothing the command did answered it.
 *
 * A deferred reply that is never followed up sits in the channel as a permanent
 * "thinking", which reads as the bot having crashed.
 *
 * @param {import('discord.js').Interaction} interaction
 */
async function settle(interaction, answered) {
  if (answered.count > 0) return;
  await interaction.editReply({ content: "Done." }).catch(() => {});
}

/**
 * Run a custom command from an interaction rather than a typed message.
 *
 * The command itself is untouched: it is handed the same stand-in message the
 * command panel uses, so one implementation serves all four triggers.
 *
 * @param {import('discord.js').Interaction} interaction
 * @param {object} command
 * @param {{args?: string[], options?: object, target?: object}} [input]
 */
async function runFromInteraction(interaction, command, input = {}) {
  const args = input.args || [];
  const answered = { count: 0 };

  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ ephemeral: true }).catch(() => {});
  }

  const message = asMessage(interaction, { command, args, prefix: "/" });
  const reply = message.safeReply;
  const counted = async (payload) => {
    answered.count += 1;
    return reply(payload);
  };
  message.safeReply = counted;
  message.reply = counted;
  message.followUp = counted;

  const result = await executeCommand(command, message, args, { options: input.options, target: input.target });
  await settle(interaction, answered);
  return result;
}

/**
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @param {object} settings
 */
async function tryCustomSlashCommand(interaction, settings, dependencies = {}) {
  if (settings?.control_center?.common?.slash_commands === false) return { handled: false };

  const command = await (dependencies.model || model).findOne({
    guild_id: interaction.guildId,
    name: String(interaction.commandName || "").toLowerCase(),
    enabled: true,
    "triggers.slash": true,
  });
  if (!command) return { handled: false };

  const { args, options } = readSlashOptions(interaction);
  return runFromInteraction(interaction, command, { args, options });
}

/**
 * The member or message a context-menu entry was used on.
 *
 * @param {import('discord.js').ContextMenuCommandInteraction} interaction
 */
function contextTarget(interaction) {
  if (interaction.isMessageContextMenuCommand?.()) {
    const target = interaction.targetMessage;
    return target ? { id: target.id, name: target.author?.username || "", content: target.content || "" } : null;
  }
  const member = interaction.targetMember || interaction.targetUser;
  return member ? { id: member.id, name: member.displayName || member.username || "", content: "" } : null;
}

/**
 * @param {import('discord.js').ContextMenuCommandInteraction} interaction
 * @param {object} settings
 */
async function tryCustomContextCommand(interaction, settings, dependencies = {}) {
  if (settings?.control_center?.common?.slash_commands === false) return { handled: false };

  const trigger = interaction.isMessageContextMenuCommand?.() ? "message_context" : "member_context";
  const candidates = await (dependencies.model || model).find({
    guild_id: interaction.guildId,
    enabled: true,
    [`triggers.${trigger}`]: true,
  });

  const command = candidates.find((entry) => contextLabel(entry) === interaction.commandName);
  if (!command) return { handled: false };

  const target = contextTarget(interaction);
  return runFromInteraction(interaction, command, { args: target?.id ? [target.id] : [], target });
}

module.exports = {
  accessProblem,
  contextTarget,
  executeCommand,
  executeAddReaction,
  executeSendDm,
  manageableRoles,
  messagePayload,
  readSlashOptions,
  renderTemplate,
  runFromInteraction,
  scheduleDeletion,
  tryCustomCommand,
  tryCustomContextCommand,
  tryCustomSlashCommand,
};
