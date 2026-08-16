const { ApplicationCommandOptionType } = require("discord.js");
const { MAX_TIMEOUT_MINUTES, model } = require("@schemas/CustomCommand");
const { contextLabel } = require("./applicationCommands");
const { asMessage } = require("@src/services/commands/message");
const { buildModal, parseModalCustomId } = require("./modalBuilder");
const modalSessions = require("./modalSessions");
const { buildPayload, scheduleDeletion, startPollFromConfig } = require("@src/services/richMessage/RichMessage");
const { isCooldownExemptModerator } = require("@src/services/moderation/policy");
const { timeoutTarget, unTimeoutTarget } = require("@helpers/ModUtils");

const cooldowns = new Map();
const RANDOM_PATTERN = /\{random:([^{}]+)\}/g;

/**
 * `{random:...}`'s own two forms: a range of whole numbers, or a set of
 * literal choices. A range is only ever two plain integers either side of a
 * dash, so a hyphenated word falls through to being read as one single
 * choice rather than being torn apart by accident.
 *
 * @param {string} spec
 * @returns {string}
 */
function randomPick(spec) {
  const trimmed = spec.trim();
  const range = /^(-?\d+)\s*-\s*(-?\d+)$/.exec(trimmed);
  if (range) {
    const [low, high] = [Number(range[1]), Number(range[2])].sort((a, b) => a - b);
    return String(low + Math.floor(Math.random() * (high - low + 1)));
  }
  const options = trimmed
    .split("|")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (!options.length) return "";
  return options[Math.floor(Math.random() * options.length)];
}

/**
 * The variables a custom command may use.
 *
 * Every one of them is a name substituted for a value. There is deliberately no
 * expression, no call and no code: a server administrator writing a message must
 * not be able to make the bot run something. `{random:...}` is the one
 * exception to "no logic" - it still never runs anything the admin did not
 * already write out in full, it just picks which of it shows.
 *
 * @param {string} value
 * @param {object} context
 * @returns {string}
 */
function renderTemplate(value, context) {
  let text = String(value || "")
    .replaceAll("{server}", context.guild.name)
    .replaceAll("{server:icon}", context.guild.iconURL?.() || "")
    .replaceAll("{server:members}", String(context.guild.memberCount ?? ""))
    .replaceAll("{member:id}", context.member.id)
    .replaceAll("{member:name}", context.member.displayName)
    .replaceAll("{member:mention}", `<@${context.member.id}>`)
    .replaceAll("{member:avatar}", context.member.displayAvatarURL?.() || "")
    .replaceAll("{channel}", `<#${context.channel.id}>`)
    .replaceAll("{arguments}", context.arguments.join(" "))
    .replaceAll("{date}", new Date().toISOString().slice(0, 10))
    .replaceAll("{time}", `${new Date().toISOString().slice(11, 16)} UTC`)
    .replace(RANDOM_PATTERN, (_, spec) => randomPick(spec));

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

  // What somebody typed into a form, by the field id the dashboard gave it.
  for (const [id, given] of Object.entries(context.modal || {})) {
    text = text.replaceAll(`{modal:${id}}`, String(given ?? ""));
  }

  return text;
}

/**
 * The id a plain `Message` and an `Interaction` each carry the invoking user
 * under a different name.
 *
 * @param {object} subject
 * @returns {string|undefined}
 */
function subjectUserId(subject) {
  return subject.author?.id || subject.user?.id;
}

/**
 * Whether a command is off-limits here for anyone, before cooldown even
 * enters into it - the same check a cooldown re-check after a form comes
 * back needs, without also re-reading a cooldown this exact invocation just
 * armed a moment ago.
 *
 * @param {object} command
 * @param {object} subject anything with `.channelId` and `.member`
 */
function permissionProblem(command, subject) {
  if (command.allowed_channels?.length && !command.allowed_channels.includes(subject.channelId)) {
    return "This custom command is not available in this channel.";
  }
  if (
    command.allowed_roles?.length &&
    !command.allowed_roles.some((roleId) => subject.member?.roles?.cache?.has(roleId))
  ) {
    return "You do not have a role allowed to use this custom command.";
  }
  return null;
}

/**
 * A command's cooldown for whoever is about to run it - zero when the
 * server's moderator-role exemption applies, the command's own configured
 * seconds otherwise. Mirrors how the built-in command policy treats the
 * same exemption.
 *
 * @param {object} command
 * @param {object} subject
 * @param {object|null} settings guild settings document
 */
function effectiveCooldown(command, subject, settings) {
  if (isCooldownExemptModerator(settings, subject.member)) return 0;
  return Number(command.cooldown_seconds) || 0;
}

/**
 * @param {object} command
 * @param {object} subject anything with `.channelId`, `.guildId` and either
 *   `.member` or the fields a `Message`/`Interaction` already carries
 * @param {object|null} [settings] guild settings document, for the
 *   moderator cooldown exemption
 */
function accessProblem(command, subject, settings = null) {
  const permission = permissionProblem(command, subject);
  if (permission) return permission;

  if (!(effectiveCooldown(command, subject, settings) > 0)) return null;
  const key = `${subject.guildId}:${command._id}:${subjectUserId(subject)}`;
  const remaining = (cooldowns.get(key) || 0) - Date.now();
  if (remaining > 0) return `This custom command is on cooldown for ${Math.ceil(remaining / 1000)} seconds.`;
  return null;
}

/**
 * Start this command's cooldown counting from now, for whoever just used it.
 *
 * @param {object} command
 * @param {object} subject
 * @param {object|null} [settings] guild settings document
 */
function markCooldown(command, subject, settings = null) {
  const seconds = effectiveCooldown(command, subject, settings);
  if (!(seconds > 0)) return;
  cooldowns.set(`${subject.guildId}:${command._id}:${subjectUserId(subject)}`, Date.now() + seconds * 1000);
}

/**
 * The stored action, in the shape the shared rich-message builder takes.
 *
 * @param {object} action
 * @returns {object}
 */
function richMessageConfig(action) {
  return {
    content: action.content,
    title: action.embed_title,
    description: action.embed_description,
    color: action.embed_color,
    author: action.embed_author,
    footer: action.embed_footer,
    thumbnail: action.embed_thumbnail,
    image: action.embed_image,
    timestamp: action.embed_timestamp,
    fields: action.fields,
    buttons: action.buttons,
    tts: action.tts,
  };
}

/**
 * @param {object} action
 * @param {object} context
 * @returns {Promise<object|null>} a sendable payload, or null for an empty message
 */
async function messagePayload(action, context) {
  return buildPayload(richMessageConfig(action), (value) => renderTemplate(value, context), {
    selfMention: context.member.id,
    roleMentions: action.mention_roles || [],
  });
}

/**
 * Where a channel-bound action actually goes: the channel it names, unless
 * that channel is gone or not one the bot can post in - the command still
 * answers, in the channel it was run from, rather than doing nothing.
 *
 * @param {object} action
 * @param {object} message
 * @returns {import('discord.js').GuildTextBasedChannel|null}
 */
function targetChannel(action, message) {
  const named = action.channel_id ? message.guild.channels.cache.get(action.channel_id) : null;
  if (action.channel_id && named?.isTextBased?.()) return named;
  return message.channel?.isTextBased?.() ? message.channel : null;
}

async function executeSendMessage(action, message, context) {
  const channel = targetChannel(action, message);
  if (!channel) return;

  if (action.poll?.question) {
    await startPollFromConfig({ guild: message.guild, channel, authorId: message.author.id, poll: action.poll }).catch(
      () => {}
    );
    return;
  }

  const payload = await messagePayload(action, context);
  if (payload) {
    const sent = await channel.send(payload);
    scheduleDeletion(sent, action.delete_after_seconds);
  }
}

async function executeSendDm(action, message, context) {
  const payload = await messagePayload(action, context);
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

/**
 * Like CHANGE_ROLES, this only ever touches whoever ran the command - a
 * command that could rename somebody else without their own hierarchy being
 * checked belongs with the moderation actions, not here.
 *
 * @param {object} action
 * @param {object} message
 * @param {object} context
 */
async function executeSetNickname(action, message, context) {
  if (typeof message.member?.setNickname !== "function") return;
  const nickname = renderTemplate(action.nickname, context).trim().slice(0, 32) || null;
  await message.member.setNickname(nickname, "SLAYBOT custom command").catch(() => {});
}

/**
 * TIMEOUT_TARGET / UNTIMEOUT_TARGET only ever touch the real Discord member a
 * message or member context menu resolved - a typed or slash invocation has
 * nobody in particular to act on, so the action simply does nothing rather
 * than guessing at a target.
 *
 * Both go through the exact moderation engine `/timeout` itself uses, with
 * whoever ran the command as the issuer: Discord's own role hierarchy, the
 * server's mute mode, ModLog, and the event router all apply exactly as they
 * would for a real moderator typing the real command.
 *
 * @param {object} action
 * @param {object} message
 * @param {object} context
 */
async function executeTimeoutTarget(action, message, context) {
  const target = context.target?.member;
  if (!target || !message.member) return;
  const reason = renderTemplate(action.reason, context).trim().slice(0, 500) || "Custom command";
  const minutes = Math.min(MAX_TIMEOUT_MINUTES, Math.max(1, Number(action.duration_minutes) || 10));
  await timeoutTarget(message.member, target, minutes * 60_000, reason).catch(() => {});
}

/**
 * @param {object} action
 * @param {object} message
 * @param {object} context
 */
async function executeUntimeoutTarget(action, message, context) {
  const target = context.target?.member;
  if (!target || !message.member) return;
  const reason = renderTemplate(action.reason, context).trim().slice(0, 500) || "Custom command";
  await unTimeoutTarget(message.member, target, reason).catch(() => {});
}

/**
 * One action, whichever kind it is. SHOW_MODAL is never run through here: it is
 * handled at invocation time, before there is a channel message or a deferred
 * interaction to run the rest of the actions against.
 *
 * @param {object} action
 * @param {object} message
 * @param {object} context
 */
async function runAction(action, message, context) {
  if (action.type === "SEND_MESSAGE") await executeSendMessage(action, message, context);
  else if (action.type === "SEND_DM") await executeSendDm(action, message, context);
  else if (action.type === "CHANGE_ROLES") await executeChangeRoles(action, message);
  else if (action.type === "ADD_REACTION") await executeAddReaction(action, message);
  else if (action.type === "SET_NICKNAME") await executeSetNickname(action, message, context);
  else if (action.type === "TIMEOUT_TARGET") await executeTimeoutTarget(action, message, context);
  else if (action.type === "UNTIMEOUT_TARGET") await executeUntimeoutTarget(action, message, context);
}

async function executeCommand(command, message, args, extra = {}, settings = null) {
  const problem = accessProblem(command, message, settings);
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
    // A command with a form shows it instead of running straight through; the
    // action after it runs only once the form comes back, from handleModalSubmit.
    if (action.type === "SHOW_MODAL") continue;
    await runAction(action, message, context);
  }

  if (command.delete_invocation && message.deletable) await message.delete().catch(() => {});
  markCooldown(command, message, settings);
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
  return executeCommand(command, message, args, {}, settings);
}

/**
 * A typed option's value, the way `{option:name}` should read in a message.
 *
 * Discord resolves a user/channel/role/mentionable option to a real object
 * alongside the raw id - substituting the raw id would put a bare snowflake
 * in the sent message where every other placeholder produces a mention.
 *
 * @param {object} entry a `CommandInteractionOption`
 * @returns {string}
 */
function resolveOptionValue(entry) {
  if (entry.value === undefined || entry.value === null) return "";
  if (entry.type === ApplicationCommandOptionType.User) return `<@${entry.value}>`;
  if (entry.type === ApplicationCommandOptionType.Channel) return `<#${entry.value}>`;
  if (entry.type === ApplicationCommandOptionType.Role) return `<@&${entry.value}>`;
  // A mentionable resolves to either a role or a user - discord.js only sets
  // `.role` when the one that was actually picked is a role.
  if (entry.type === ApplicationCommandOptionType.Mentionable)
    return entry.role ? `<@&${entry.value}>` : `<@${entry.value}>`;
  // An attachment's value is its own snowflake id, not a link - the url worth
  // substituting lives on the resolved attachment instead.
  if (entry.type === ApplicationCommandOptionType.Attachment) return entry.attachment?.url || "";
  return String(entry.value);
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
    options[entry.name] = resolveOptionValue(entry);
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
 * The stand-in message a command's actions run against, counting whether any
 * of them actually answered the interaction.
 *
 * @param {import('discord.js').Interaction} interaction
 * @param {object} command
 * @param {string[]} args
 */
function trackedMessage(interaction, command, args) {
  const answered = { count: 0 };
  const message = asMessage(interaction, { command, args, prefix: "/" });
  const reply = message.safeReply;
  const counted = async (payload) => {
    answered.count += 1;
    return reply(payload);
  };
  message.safeReply = counted;
  message.reply = counted;
  message.followUp = counted;
  return { message, answered };
}

/**
 * Run a custom command from an interaction rather than a typed message.
 *
 * The command itself is untouched: it is handed the same stand-in message the
 * command panel uses, so one implementation serves all four triggers. A command
 * built around a form is the one exception: showing it has to be the very first
 * answer to the interaction, before anything else touches it, so that branches
 * off before the usual deferred-reply flow starts.
 *
 * @param {import('discord.js').Interaction} interaction
 * @param {object} command
 * @param {{args?: string[], options?: object, target?: object}} [input]
 * @param {object|null} [settings] guild settings document
 */
async function runFromInteraction(interaction, command, input = {}, settings = null) {
  const modalAction = (command.actions || []).find((action) => action.type === "SHOW_MODAL");
  if (modalAction) return presentModal(interaction, command, modalAction, input, settings);

  const args = input.args || [];

  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ ephemeral: true }).catch(() => {});
  }

  const { message, answered } = trackedMessage(interaction, command, args);
  const result = await executeCommand(
    command,
    message,
    args,
    { options: input.options, target: input.target },
    settings
  );
  await settle(interaction, answered);
  return result;
}

/**
 * Open a command's form. This has to be the interaction's first and only
 * immediate answer — Discord refuses a modal shown after a deferral or a
 * reply — so access and cooldown are checked here rather than left to
 * `executeCommand`, and nothing else runs until the form comes back.
 *
 * @param {import('discord.js').Interaction} interaction
 * @param {object} command
 * @param {object} modalAction
 * @param {{args?: string[], options?: object, target?: object}} [extra]
 * @param {object|null} [settings] guild settings document
 */
async function presentModal(interaction, command, modalAction, extra = {}, settings = null) {
  const problem = accessProblem(command, interaction, settings);
  if (problem) {
    await interaction.reply({ content: problem, ephemeral: true }).catch(() => {});
    return { handled: true, executed: false };
  }

  const token = modalSessions.create({
    guildId: interaction.guildId,
    commandId: String(command._id),
    userId: interaction.user.id,
    args: extra.args || [],
    options: extra.options || {},
    target: extra.target || null,
  });

  try {
    await interaction.showModal(buildModal(modalAction, token));
  } catch (error) {
    modalSessions.discard(token);
    interaction.client?.logger?.error?.("customCommand: could not open form", error);
    return { handled: true, executed: false };
  }

  markCooldown(command, interaction, settings);
  return { handled: true, executed: false, presentedModal: true };
}

/**
 * @param {import('discord.js').ModalSubmitInteraction} interaction
 */
function matchesModal(customId) {
  return parseModalCustomId(customId) !== null;
}

/**
 * A form came back. Its session says which command it belongs to and which of
 * that command's other actions is the one to run now, with what was typed
 * available as `{modal:<fieldId>}`.
 *
 * The session is consumed on the very first read, whether or not it turns out
 * to be usable — an expired form and a resubmitted one look identical from
 * here, and both get the same "nothing to run" answer instead of running
 * anything twice.
 *
 * @param {import('discord.js').ModalSubmitInteraction} interaction
 * @param {object} [dependencies]
 */
async function handleModalSubmit(interaction, dependencies = {}) {
  const token = parseModalCustomId(interaction.customId);
  const session = token ? modalSessions.consume(token, interaction.user.id) : null;

  if (!session) {
    return interaction
      .reply({ content: "This form has expired or was already submitted.", ephemeral: true })
      .catch(() => {});
  }

  const command = await (dependencies.model || model)
    .findOne({ _id: session.commandId, guild_id: session.guildId, enabled: true })
    .catch(() => null);
  const modalAction = command?.actions?.find((action) => action.type === "SHOW_MODAL");

  if (!command || !modalAction) {
    return interaction.reply({ content: "This command is no longer available.", ephemeral: true }).catch(() => {});
  }

  // Access was already checked when the form was opened; a role or channel
  // change in the meantime is re-checked here, not cooldown - that was
  // already armed for this exact invocation moments ago.
  const permission = permissionProblem(command, interaction);
  if (permission) {
    return interaction.reply({ content: permission, ephemeral: true }).catch(() => {});
  }

  const modalValues = {};
  for (const input of modalAction.modal_inputs || []) {
    modalValues[input.id] = interaction.fields.getTextInputValue(input.id) || "";
  }

  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ ephemeral: true }).catch(() => {});
  }

  const confirmAction = command.actions.find((action) => action.id === modalAction.confirm_action_id);
  const { message, answered } = trackedMessage(interaction, command, session.args || []);

  if (confirmAction) {
    await runAction(confirmAction, message, {
      guild: interaction.guild,
      channel: interaction.channel,
      member: interaction.member,
      arguments: session.args || [],
      target: session.target || null,
      options: session.options || {},
      modal: modalValues,
    });
  }

  await settle(interaction, answered);
  return { handled: true, executed: Boolean(confirmAction) };
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
  return runFromInteraction(interaction, command, { args, options }, settings);
}

/**
 * The member or message a context-menu entry was used on.
 *
 * @param {import('discord.js').ContextMenuCommandInteraction} interaction
 */
function contextTarget(interaction) {
  if (interaction.isMessageContextMenuCommand?.()) {
    const target = interaction.targetMessage;
    if (!target) return null;
    return {
      id: target.id,
      name: target.author?.username || "",
      content: target.content || "",
      // A moderation action needs the real member, not just who wrote the
      // message - a member the guild has not cached simply has none to act on.
      member: interaction.guild?.members?.cache?.get(target.author?.id) || null,
    };
  }
  const member = interaction.targetMember || null;
  const user = interaction.targetUser;
  if (!member && !user) return null;
  return { id: (member || user).id, name: member?.displayName || user?.username || "", content: "", member };
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
  return runFromInteraction(interaction, command, { args: target?.id ? [target.id] : [], target }, settings);
}

module.exports = {
  accessProblem,
  contextTarget,
  effectiveCooldown,
  executeCommand,
  executeAddReaction,
  executeSendDm,
  handleModalSubmit,
  manageableRoles,
  markCooldown,
  matchesModal,
  messagePayload,
  permissionProblem,
  presentModal,
  readSlashOptions,
  renderTemplate,
  resetCooldowns: () => cooldowns.clear(),
  resolveOptionValue,
  runAction,
  runFromInteraction,
  scheduleDeletion,
  tryCustomCommand,
  tryCustomContextCommand,
  tryCustomSlashCommand,
};
