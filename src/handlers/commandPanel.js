const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder } = require("discord.js");
const { EMBED_COLORS } = require("@root/config");
const { applyBranding, resolveBranding } = require("@helpers/Branding");
const { guildTranslator } = require("@src/i18n");
const commandHandler = require("@src/handlers/command");
const catalog = require("@src/services/commands/catalog");
const draft = require("@src/services/panels/draft");
const { asCommandInteraction, buildOptions } = require("@src/services/commands/proxy");
const { asMessage } = require("@src/services/commands/message");
const editor = require("@src/services/panels/fieldEditor");

/**
 * Every command of the bot, as a panel.
 *
 * The point is that nothing has to be remembered: open the panel, pick what you
 * want to do, fill in the boxes it shows you, press run. A command declares its
 * options for Discord already, so the form is built from that declaration rather
 * than written out a second time here — and the command itself runs untouched.
 *
 * Three screens, in one message: the categories, the commands of a category, and
 * one command's form.
 *
 *   CMDP:home              the categories
 *   CMDP:cat:<CATEGORY>    the commands of a category
 *   CMDP:cmd:<path>        one command, or its list of subcommands
 *   CMDP:opt:<name>        the button of one option on the open form
 *   CMDP~SEL:...           a picker the form opened
 *   CMDP~MOD:...           a modal the form opened
 *   CMDP:run:<path>        run what the form was filled in with
 */

const PREFIX = "CMDP";
const SELECT_MARK = "~SEL";
const MODAL_MARK = "~MOD";
const CATALOG_ICON = "📚";

const HOME = `${PREFIX}:home`;
const buttonId = (action, ref = "") => `${PREFIX}:${action}${ref ? `:${ref}` : ""}`;
const selectId = (action, ref = "") => `${PREFIX}${SELECT_MARK}:${action}:${ref}`;
const modalId = (action, ref = "") => `${PREFIX}${MODAL_MARK}:${action}:${ref}`;

/**
 * @param {string} customId
 * @returns {{kind: "button"|"select"|"modal", action: string, ref: string}|null}
 */
function parse(customId) {
  const text = String(customId);
  const mark = text.startsWith(`${PREFIX}${SELECT_MARK}:`)
    ? SELECT_MARK
    : text.startsWith(`${PREFIX}${MODAL_MARK}:`)
      ? MODAL_MARK
      : text.startsWith(`${PREFIX}:`)
        ? ""
        : null;

  if (mark === null) return null;

  const kind = mark === SELECT_MARK ? "select" : mark === MODAL_MARK ? "modal" : "button";
  const [action, ...rest] = text.slice(PREFIX.length + mark.length + 1).split(":");
  return { kind, action, ref: rest.join(":") };
}

/**
 * @param {string} text
 * @param {number} limit
 */
function fit(text, limit) {
  const clean = String(text).replaceAll("\n", " ").trim();
  return clean.length > limit ? `${clean.slice(0, limit - 1)}…` : clean;
}

/**
 * @param {import('discord.js').Interaction} interaction
 * @param {EmbedBuilder} embed
 */
function brand(interaction, embed, settings) {
  applyBranding(embed, resolveBranding(settings, interaction.client), { force: true });
  return embed;
}

/**
 * The way out of any screen: back to where it came from, and home.
 *
 * @param {(key: string, vars?: object) => string} t
 * @param {string} backId
 * @param {ButtonBuilder[]} [before]
 */
function navigationRow(t, backId, before = []) {
  return new ActionRowBuilder().addComponents([
    ...before,
    new ButtonBuilder().setCustomId(backId).setEmoji("↩️").setLabel(t("common.back")).setStyle(ButtonStyle.Secondary),
    // Home is the catalogue rather than the settings hub: anybody may open this
    // panel, and the hub is behind Manage Server.
    new ButtonBuilder().setCustomId(HOME).setEmoji("🏠").setLabel(t("commands.all")).setStyle(ButtonStyle.Secondary),
  ]);
}

/* ------------------------------------------------------------------ screens */

/**
 * Screen one: the categories, as many as this member has anything in.
 *
 * @param {(key: string, vars?: object) => string} t
 * @param {import('discord.js').Interaction} interaction
 * @param {object} settings
 */
function buildCatalog(t, interaction, settings) {
  const categories = catalog.categoriesFor(interaction.client, interaction.member, t);
  const total = categories.reduce((sum, category) => sum + category.count, 0);

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLORS.BOT_EMBED)
    .setTitle(`${CATALOG_ICON} ${t("commands.title")}`)
    .setDescription(
      [
        t("commands.description", { count: total }),
        "",
        categories.map((category) => `${category.emoji} **${category.name}** · ${category.count}`).join("\n") ||
          t("commands.emptyCatalog"),
        "",
        `-# ${t("commands.hint")}`,
      ].join("\n")
    );

  brand(interaction, embed, settings);

  const rows = [];
  for (let index = 0; index < categories.length && rows.length < 4; index += 5) {
    rows.push(
      new ActionRowBuilder().addComponents(
        categories
          .slice(index, index + 5)
          .map((category) =>
            new ButtonBuilder()
              .setCustomId(buttonId("cat", category.id))
              .setEmoji(category.emoji)
              .setLabel(fit(category.name, 40))
              .setStyle(ButtonStyle.Secondary)
          )
      )
    );
  }

  // The settings hub is only worth offering to somebody who may open it.
  if (interaction.member?.permissions?.has(catalog.PermissionFlagsBits.ManageGuild)) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("PANELHUB:home")
          .setEmoji("🎛️")
          .setLabel(t("commands.settings"))
          .setStyle(ButtonStyle.Secondary)
      )
    );
  }

  return { embeds: [embed], components: rows };
}

/**
 * Screen two: what a category holds. Commands are offered as a menu rather than
 * as buttons — a category can hold more than twenty-five of them, and a menu says
 * what each one does on the same line.
 *
 * @param {(key: string, vars?: object) => string} t
 * @param {import('discord.js').Interaction} interaction
 * @param {object} settings
 * @param {string} category
 */
function buildCategory(t, interaction, settings, category, page = 0) {
  const commands = catalog.commandsIn(interaction.client, interaction.member, category);
  const meta = catalog.categoriesFor(interaction.client, interaction.member, t).find((entry) => entry.id === category);

  // A menu holds twenty-five rows, and a category can outgrow that.
  const pages = Math.max(1, Math.ceil(commands.length / catalog.PAGE));
  const current = Math.min(Math.max(page, 0), pages - 1);
  const shown = commands.slice(current * catalog.PAGE, (current + 1) * catalog.PAGE);

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLORS.BOT_EMBED)
    .setTitle(`${meta?.emoji || "▫️"} ${meta?.name || category}`)
    .setDescription(
      [
        t("commands.pickCommand"),
        "",
        shown.map((command) => `\`/${command.name}\` — ${fit(command.description, 70)}`).join("\n"),
        "",
        `-# ${pages > 1 ? t("commands.page", { page: current + 1, pages }) : t("commands.hint")}`,
      ].join("\n")
    );

  brand(interaction, embed, settings);

  const menu = new StringSelectMenuBuilder()
    .setCustomId(selectId("cmd", category))
    .setPlaceholder(t("commands.pickCommand"))
    .addOptions(
      shown.map((command) => ({
        value: command.name,
        label: fit(`/${command.name}`, 100),
        description: fit(command.description, 100) || undefined,
      }))
    );

  const paging =
    pages > 1
      ? [
          new ButtonBuilder()
            .setCustomId(buttonId("cat", `${category}:${current - 1}`))
            .setEmoji("◀️")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(current === 0),
          new ButtonBuilder()
            .setCustomId(buttonId("cat", `${category}:${current + 1}`))
            .setEmoji("▶️")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(current >= pages - 1),
        ]
      : [];

  return {
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(menu), navigationRow(t, HOME, paging)],
  };
}

/**
 * A command that has subcommands: pick which one to run.
 *
 * @param {(key: string, vars?: object) => string} t
 * @param {import('discord.js').Interaction} interaction
 * @param {object} settings
 * @param {object} command
 * @param {object[]} leaves
 */
function buildSubcommands(t, interaction, settings, command, leaves) {
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLORS.BOT_EMBED)
    .setTitle(`▶️ /${command.name}`)
    .setDescription(
      [
        command.description || t("commands.pickAction"),
        "",
        leaves.map((leaf) => `\`/${leaf.path}\` — ${fit(leaf.description, 70)}`).join("\n"),
        "",
        `-# ${t("commands.hint")}`,
      ].join("\n")
    );

  brand(interaction, embed, settings);

  const menu = new StringSelectMenuBuilder()
    .setCustomId(selectId("leaf", command.name))
    .setPlaceholder(t("commands.pickAction"))
    .addOptions(
      leaves.slice(0, catalog.PAGE).map((leaf) => ({
        value: leaf.path,
        label: fit(`/${leaf.path}`, 100),
        description: fit(leaf.description, 100) || undefined,
      }))
    );

  return {
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(menu), navigationRow(t, buttonId("cat", command.category))],
  };
}

/**
 * Screen three: one command's form — every option it takes, what it is set to,
 * and a button per option to change it.
 *
 * @param {(key: string, vars?: object) => string} t
 * @param {import('discord.js').Interaction} interaction
 * @param {object} settings
 * @param {{command: object, leaf: object}} target
 * @param {{focus?: string}} [view]
 */
function buildForm(t, interaction, settings, { command, leaf }, { focus = null } = {}) {
  const values = draft.read(interaction.user.id, leaf.path);
  const missing = leaf.options.filter((option) => option.required && values[option.id] === undefined);

  const lines = editor.lines(t, leaf.options, values, { focus });

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLORS.BOT_EMBED)
    .setTitle(`▶️ /${leaf.path}`)
    .setDescription(
      [
        leaf.description || command.description || "",
        "",
        lines.length ? lines.join("\n") : t("commands.noOptions"),
        "",
        `-# ${missing.length ? t("commands.missing", { names: missing.map((option) => option.name).join(", ") }) : t("commands.readyHint")}`,
      ].join("\n")
    );

  brand(interaction, embed, settings);

  // Four rows of five, and the fifth row is the one that runs it — twenty options
  // is well past anything the bot declares, and past what a form should ask for.
  const rows = editor.rows(t, leaf.options, values, (option) => buttonId("opt", `${leaf.path}|${option.id}`));

  const run = new ButtonBuilder()
    .setCustomId(buttonId("run", leaf.path))
    .setEmoji("▶️")
    .setLabel(t("commands.run"))
    .setStyle(ButtonStyle.Success)
    .setDisabled(missing.length > 0);

  const back = leaf.subcommand ? buttonId("cmd", command.name) : buttonId("cat", command.category);
  rows.push(navigationRow(t, back, [run]));

  return { embeds: [embed], components: rows };
}

/**
 * The form with one picker open in place of the option buttons.
 *
 * @param {(key: string, vars?: object) => string} t
 * @param {import('discord.js').Interaction} interaction
 * @param {object} settings
 * @param {{command: object, leaf: object}} target
 * @param {object} option
 */
function buildPicker(t, interaction, settings, target, option) {
  const { leaf } = target;
  const base = buildForm(t, interaction, settings, target, { focus: option.id });
  const values = draft.read(interaction.user.id, leaf.path);
  const current = values[option.id] ?? null;
  const customId = selectId("opt", `${leaf.path}|${option.id}`);
  const placeholder = fit(option.description || option.name, 100);

  const menu = editor.select(option, current, { customId, placeholder, guild: interaction.guild });

  return {
    embeds: base.embeds,
    components: [new ActionRowBuilder().addComponents(menu), navigationRow(t, buttonId("cmd", leaf.path))],
  };
}

/**
 * @param {object} option
 * @param {*} current
 * @param {string} path
 * @param {(key: string, vars?: object) => string} t
 */
function buildModal(option, current, path, t) {
  return editor.modal(option, current, { customId: modalId("opt", `${path}|${option.id}`), t });
}

/* ------------------------------------------------------------------ running */

/**
 * Hand the filled-in form to the command itself.
 *
 * The click becomes the command's own interaction, so the command answers in its
 * usual way and the panel is left alone above the answer.
 *
 * @param {import('discord.js').Interaction} interaction
 * @param {{command: object, leaf: object}} target
 * @param {(key: string, vars?: object) => string} t
 */
async function run(interaction, { command, leaf }, t, settings) {
  const problem =
    commandHandler.accessProblem(command, {
      user: interaction.user,
      member: interaction.member,
      guild: interaction.guild,
    }) || commandHandler.cooldownProblem(command, interaction.user.id);

  if (problem) return interaction.reply({ content: problem, ephemeral: true });

  const values = draft.read(interaction.user.id, leaf.path);
  const stillMissing = leaf.options.filter((option) => option.required && values[option.id] === undefined);
  if (stillMissing.length) {
    return interaction.reply({
      content: t("commands.missing", { names: stillMissing.map((option) => option.name).join(", ") }),
      ephemeral: true,
    });
  }

  const startedAt = Date.now();
  let succeeded = false;

  try {
    // The panel stays where it is: the command's answer arrives as its own
    // message, exactly as it would have from a slash command.
    if (leaf.prefixOnly) {
      // A prefix command speaks in the channel, the way it would have if it had
      // been typed there; only the owner tools stay private.
      await interaction.deferReply({ ephemeral: command.category === "OWNER" });
    } else if (command.slashCommand.defer !== false && !interaction.deferred && !interaction.replied) {
      await interaction.deferReply({ ephemeral: command.slashCommand.ephemeral });
    }

    if (leaf.prefixOnly) await runAsMessage(interaction, command, values.args || "", settings);
    else {
      const proxy = asCommandInteraction(interaction, {
        commandName: command.name,
        options: buildOptions({
          options: leaf.options,
          values,
          subcommand: leaf.subcommand,
          group: leaf.group,
          guild: interaction.guild,
        }),
      });

      await command.interactionRun(proxy, { settings });
    }

    succeeded = true;
  } catch (error) {
    interaction.client.logger?.error("panel command", error);
    await interaction.safeFollowUp({
      content: error?.safeMessage || t("commands.failed"),
      ephemeral: true,
    });
  } finally {
    interaction.client.telemetry?.recordCommand({
      guildId: interaction.guildId,
      userId: interaction.user.id,
      commandName: command.name,
      source: "panel",
      success: succeeded,
      durationMs: Date.now() - startedAt,
    });
    if (command.cooldown > 0) commandHandler.applyCooldown(interaction.user.id, command);
  }

  return true;
}

/**
 * Run a command that only exists as a prefix command.
 *
 * @param {import('discord.js').Interaction} interaction
 * @param {object} command
 * @param {string} line what was typed into the arguments box
 * @param {object} settings guild settings document
 */
async function runAsMessage(interaction, command, line, settings) {
  const args = String(line).split(/\s+/).filter(Boolean);
  const prefix = settings?.prefix || "!";
  const message = asMessage(interaction, { command, args, prefix });

  return command.messageRun(message, args, { settings, prefix, invoke: command.name });
}

/* ------------------------------------------------------------------ routing */

/**
 * Open whichever screen a path points at: the form when it names one runnable
 * thing, the list of subcommands when it names a command with several.
 */
function openCommand(t, interaction, settings, path) {
  const [name] = path.split(" ");
  const command = interaction.client.slashCommands.get(name);
  if (!command || !catalog.allowed(command, interaction.member)) return null;

  const leaves = catalog.leavesOf(command);
  const leaf = leaves.find((entry) => entry.path === path);

  if (leaf) return buildForm(t, interaction, settings, { command, leaf });
  if (leaves.length > 1) return buildSubcommands(t, interaction, settings, command, leaves);

  return leaves[0] ? buildForm(t, interaction, settings, { command, leaf: leaves[0] }) : null;
}

module.exports = {
  HOME,
  PREFIX,
  buildCatalog,
  buildCategory,
  buildForm,
  buildPicker,
  parse,

  /**
   * @param {string} customId
   * @returns {boolean}
   */
  matches(customId) {
    return parse(customId) !== null;
  },

  /**
   * @param {import('discord.js').Interaction} interaction
   * @param {object} settings guild settings document
   * @returns {Promise<boolean>} whether the interaction belonged here
   */
  async handle(interaction, settings) {
    const parsed = parse(interaction.customId);
    if (!parsed) return false;

    const t = guildTranslator(settings, interaction.guild);
    const redraw = (payload) => interaction.update(payload);

    if (parsed.action === "home") {
      await redraw(buildCatalog(t, interaction, settings));
      return true;
    }

    if (parsed.action === "cat") {
      const [category, page] = parsed.ref.split(":");
      await redraw(buildCategory(t, interaction, settings, category, Number.parseInt(page, 10) || 0));
      return true;
    }

    // The commands menu of a category, and the subcommand menu of a command.
    if (parsed.kind === "select" && (parsed.action === "cmd" || parsed.action === "leaf")) {
      const screen = openCommand(t, interaction, settings, interaction.values[0]);
      await redraw(screen || buildCatalog(t, interaction, settings));
      return true;
    }

    if (parsed.action === "cmd") {
      const screen = openCommand(t, interaction, settings, parsed.ref);
      await redraw(screen || buildCatalog(t, interaction, settings));
      return true;
    }

    if (parsed.action === "run") {
      const target = catalog.resolve(interaction.client, interaction.member, parsed.ref);
      if (!target) {
        await redraw(buildCatalog(t, interaction, settings));
        return true;
      }

      await run(interaction, target, t, settings);
      return true;
    }

    if (parsed.action === "opt") {
      const [path, optionId] = parsed.ref.split("|");
      const target = catalog.resolve(interaction.client, interaction.member, path);
      const option = target?.leaf.options.find((entry) => entry.id === optionId);

      if (!option) {
        await redraw(buildCatalog(t, interaction, settings));
        return true;
      }

      const values = draft.read(interaction.user.id, path);

      if (parsed.kind === "modal") {
        const raw = interaction.fields.getTextInputValue("value").trim();
        draft.write(interaction.user.id, path, optionId, parseValue(option, raw));
        await redraw(buildForm(t, interaction, settings, target));
        return true;
      }

      if (parsed.kind === "select") {
        draft.write(interaction.user.id, path, optionId, interaction.values[0] ?? null);
        await redraw(buildForm(t, interaction, settings, target));
        return true;
      }

      if (option.type === "toggle") {
        draft.write(interaction.user.id, path, optionId, !values[optionId]);
        await redraw(buildForm(t, interaction, settings, target));
        return true;
      }

      if (option.type === "text" || option.type === "number") {
        await interaction.showModal(buildModal(option, values[optionId] ?? null, path, t));
        return true;
      }

      await redraw(buildPicker(t, interaction, settings, target, option));
      return true;
    }

    return true;
  },
};

/**
 * Turn what somebody typed into what the command expects to be given.
 *
 * @param {object} option
 * @param {string} raw
 */
function parseValue(option, raw) {
  if (raw === "") return null;
  if (option.type !== "number") return raw;

  const parsed = Number.parseInt(raw, 10);
  if (!/^-?\d+$/.test(raw)) return null;

  return Math.min(Math.max(parsed, option.min ?? Number.MIN_SAFE_INTEGER), option.max ?? Number.MAX_SAFE_INTEGER);
}
