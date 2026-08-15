const test = require("node:test");
const assert = require("node:assert/strict");
require("module-alias/register");
// The real-command coverage tests below load every file under src/commands,
// including the giveaway commands - discord-giveaways pulls in
// serialize-javascript, which references the bare `crypto` global that
// Node only exposes unconditionally from v19 onward. See polyfillGlobalCrypto.
require("@helpers/polyfillGlobalCrypto")();

const { ApplicationCommandOptionType, ButtonStyle, Collection } = require("discord.js");
const panel = require("@src/handlers/commandPanel");
const catalog = require("@src/services/commands/catalog");
const draft = require("@src/services/panels/draft");

const USER = "100000000000000001";
const TARGET = "100000000000000042";
const STAFF_ROLE = "100000000000000007";

/* ------------------------------------------------------------- the fixtures */

/**
 * A slash command with one option of each kind the panel has to ask for.
 */
function slashCommand(overrides = {}) {
  const ran = [];

  return {
    ran,
    name: "ban",
    description: "bans the specified member",
    category: "MODERATION",
    userPermissions: ["BanMembers"],
    cooldown: 0,
    command: { enabled: false },
    slashCommand: {
      enabled: true,
      ephemeral: false,
      options: [
        { name: "user", description: "the member to ban", type: ApplicationCommandOptionType.User, required: true },
        { name: "reason", description: "why", type: ApplicationCommandOptionType.String, required: false },
        { name: "days", description: "days of messages", type: ApplicationCommandOptionType.Integer },
        { name: "silent", description: "no announcement", type: ApplicationCommandOptionType.Boolean },
        {
          name: "scope",
          description: "how far it reaches",
          type: ApplicationCommandOptionType.String,
          choices: [
            { name: "this server", value: "GUILD" },
            { name: "everywhere", value: "GLOBAL" },
          ],
        },
      ],
    },
    interactionRun: async (interaction, data) => {
      ran.push({
        user: interaction.options.getUser("user"),
        reason: interaction.options.getString("reason"),
        days: interaction.options.getInteger("days"),
        silent: interaction.options.getBoolean("silent"),
        scope: interaction.options.getString("scope"),
        commandName: interaction.commandName,
        settings: data.settings,
      });
      await interaction.safeFollowUp({ content: "done" });
    },
    ...overrides,
  };
}

/**
 * A command that only ever existed with a prefix.
 */
function prefixCommand(overrides = {}) {
  const ran = [];

  return {
    ran,
    name: "setrr",
    description: "configure all reaction roles for a message at once",
    category: "ADMIN",
    userPermissions: ["ManageGuild"],
    cooldown: 0,
    command: { enabled: true, usage: "<#channel> <messageId> <emoji @role>", minArgsCount: 3 },
    slashCommand: { enabled: false },
    messageRun: async (message, args, data) => {
      ran.push({ args, content: message.content, prefix: data.prefix, mentions: message.mentions });
      await message.safeReply("set");
    },
    ...overrides,
  };
}

/**
 * A command with subcommands, to check the middle screen.
 */
function grouped() {
  return {
    name: "ticket",
    description: "ticket tools",
    category: "TICKET",
    cooldown: 0,
    command: { enabled: false },
    slashCommand: {
      enabled: true,
      options: [
        {
          name: "add",
          description: "add somebody to this ticket",
          type: ApplicationCommandOptionType.Subcommand,
          options: [{ name: "user_id", description: "who", type: ApplicationCommandOptionType.String, required: true }],
        },
        { name: "close", description: "close it", type: ApplicationCommandOptionType.Subcommand, options: [] },
      ],
    },
    interactionRun: async () => {},
  };
}

/**
 * @param {object[]} commands
 * @param {{permissions?: boolean, customId?: string, values?: string[], text?: string}} [input]
 */
function makeInteraction(commands, { permissions = true, customId = "CMDP:home", values, text } = {}) {
  const seen = { update: [], reply: [], modal: [], defer: [], followUp: [] };

  const slashCommands = new Collection();
  for (const command of commands) if (command.slashCommand?.enabled) slashCommands.set(command.name, command);

  const guild = {
    id: "900000000000000009",
    preferredLocale: "ru",
    channels: { cache: new Map() },
    roles: { cache: new Map([[STAFF_ROLE, { id: STAFF_ROLE, name: "staff" }]]) },
    members: {
      cache: new Map([[TARGET, { id: TARGET, user: { id: TARGET, username: "target" } }]]),
      me: { permissions: { has: () => true } },
    },
  };
  guild.client = { users: { cache: new Map() } };

  return {
    customId,
    values,
    seen,
    id: "1",
    guildId: guild.id,
    guild,
    channel: { id: "5" },
    channelId: "5",
    user: { id: USER },
    member: { id: USER, permissions: { has: () => permissions } },
    client: { commands, slashCommands, logger: { error: () => {} }, user: { username: "SLAYBOT" } },
    fields: { getTextInputValue: () => text },
    deferred: false,
    replied: false,
    isFromMessage: () => true,
    update: async (payload) => seen.update.push(payload),
    reply: async (payload) => seen.reply.push(payload),
    showModal: async (modal) => seen.modal.push(modal),
    deferReply: async (options) => seen.defer.push(options),
    safeFollowUp: async (payload) => seen.followUp.push(payload),
  };
}

const route = (interaction, settings = { prefix: "!" }) => panel.handle(interaction, settings);

test.beforeEach(() => draft.reset());

/* ----------------------------------------------------------------- catalogue */

test("the catalogue offers every category the member can use", async () => {
  const commands = [slashCommand(), prefixCommand(), grouped()];
  const interaction = makeInteraction(commands);

  await route(interaction);

  const [payload] = interaction.seen.update;
  const labels = payload.components.flatMap((row) => row.components.map((button) => button.data.label));

  assert.match(payload.embeds[0].data.title, /Все команды/);
  // The sections are named in the server's language.
  assert.ok(labels.includes("Модерация"), "moderation is missing");
  assert.ok(labels.includes("Администрирование"), "a prefix-only command still gets its category");
});

test("a member is not offered what they may not run", () => {
  const commands = [slashCommand(), prefixCommand()];
  const barred = { id: USER, permissions: { has: () => false } };

  const names = catalog.commandsFor({ commands, slashCommands: new Collection() }, barred).map((cmd) => cmd.name);
  assert.deepEqual(names, [], "commands behind a permission are hidden, not refused later");
});

test("a category lists its commands in a menu", async () => {
  const commands = [slashCommand(), grouped()];
  const interaction = makeInteraction(commands, { customId: "CMDP:cat:MODERATION" });

  await route(interaction);

  const [payload] = interaction.seen.update;
  const menu = payload.components[0].components[0].toJSON();
  assert.deepEqual(
    menu.options.map((option) => option.value),
    ["ban"]
  );
});

test("a command with subcommands asks which one first", async () => {
  const interaction = makeInteraction([grouped()], { customId: "CMDP:cmd:ticket" });

  await route(interaction);

  const menu = interaction.seen.update[0].components[0].components[0].toJSON();
  assert.deepEqual(
    menu.options.map((option) => option.value),
    ["ticket add", "ticket close"]
  );
});

/* ---------------------------------------------------------------- the form */

test("the form shows every option, and marks what the command cannot run without", async () => {
  const interaction = makeInteraction([slashCommand()], { customId: "CMDP:cmd:ban" });

  await route(interaction);

  const [payload] = interaction.seen.update;
  const description = payload.embeds[0].data.description;

  assert.match(description, /\*\*user:\*\* ⚠️/, "a required option is flagged");
  assert.match(description, /\*\*reason:\*\* ⚪/, "an optional one is not");

  const buttons = payload.components.flatMap((row) => row.components).map((button) => button.data);
  const run = buttons.find((button) => button.custom_id === "CMDP:run:ban");
  assert.equal(run.disabled, true, "nothing can be run before it is filled in");
  assert.equal(
    buttons.find((button) => button.custom_id === "CMDP:opt:ban|user").style,
    ButtonStyle.Danger,
    "the missing option stands out"
  );
});

test("a filled-in option is kept, shown and unlocks the run button", async () => {
  const commands = [slashCommand()];

  const picked = makeInteraction(commands, { customId: "CMDP~SEL:opt:ban|user", values: [TARGET] });
  await route(picked);

  const description = picked.seen.update[0].embeds[0].data.description;
  assert.match(description, new RegExp(`\\*\\*user:\\*\\* <@${TARGET}>`));

  const run = picked.seen.update[0].components
    .flatMap((row) => row.components)
    .find((button) => button.data.custom_id === "CMDP:run:ban");
  assert.equal(run.data.disabled, false);
});

test("a text option opens a modal carrying what is already there", async () => {
  draft.write(USER, "ban", "reason", "спам");
  const interaction = makeInteraction([slashCommand()], { customId: "CMDP:opt:ban|reason" });

  await route(interaction);

  const modal = interaction.seen.modal[0].toJSON();
  assert.equal(modal.custom_id, "CMDP~MOD:opt:ban|reason");
  assert.equal(modal.components[0].components[0].value, "спам");
});

test("a toggle flips in place", async () => {
  const interaction = makeInteraction([slashCommand()], { customId: "CMDP:opt:ban|silent" });

  await route(interaction);

  assert.equal(draft.read(USER, "ban").silent, true);
  assert.match(interaction.seen.update[0].embeds[0].data.description, /\*\*silent:\*\* 🟢/);
});

test("a number is kept inside the range the option declares", async () => {
  const command = slashCommand();
  command.slashCommand.options[2].minValue = 0;
  command.slashCommand.options[2].maxValue = 7;

  const interaction = makeInteraction([command], { customId: "CMDP~MOD:opt:ban|days", text: "99" });
  await route(interaction);

  assert.equal(draft.read(USER, "ban").days, 7);
});

test("a number the command left unbounded is taken as it was typed", async () => {
  const command = slashCommand();
  // `days` declares no minValue or maxValue, the way most numeric options do.
  const interaction = makeInteraction([command], { customId: "CMDP~MOD:opt:ban|days", text: "5000000" });

  await route(interaction);

  assert.equal(draft.read(USER, "ban").days, 5000000, "the panel does not invent a ceiling of its own");
});

test("a number box is wide enough for what the command accepts", async () => {
  const command = slashCommand();
  const interaction = makeInteraction([command], { customId: "CMDP:opt:ban|days" });

  await route(interaction);

  const input = interaction.seen.modal[0].toJSON().components[0].components[0];
  assert.ok(input.max_length >= 7, `an unbounded number got a ${input.max_length}-character box`);
});

test("free text the command did not cap is not capped at some panel default", async () => {
  const command = slashCommand();
  const interaction = makeInteraction([command], { customId: "CMDP:opt:ban|reason" });

  await route(interaction);

  const input = interaction.seen.modal[0].toJSON().components[0].components[0];
  assert.ok(input.max_length > 200, `a reason of any length was cut to ${input.max_length} characters`);
});

/* -------------------------------------------------------------- running it */

test("running hands the command what the form was filled in with", async () => {
  const command = slashCommand();
  draft.write(USER, "ban", "user", TARGET);
  draft.write(USER, "ban", "reason", "спам в личку");
  draft.write(USER, "ban", "days", 3);
  draft.write(USER, "ban", "silent", true);
  draft.write(USER, "ban", "scope", "GLOBAL");

  const interaction = makeInteraction([command], { customId: "CMDP:run:ban" });
  const settings = { prefix: "!" };

  await route(interaction, settings);

  assert.equal(command.ran.length, 1, "the command ran once");
  const [call] = command.ran;
  assert.equal(call.user.id, TARGET);
  assert.equal(call.reason, "спам в личку");
  assert.equal(call.days, 3);
  assert.equal(call.silent, true);
  assert.equal(call.scope, "GLOBAL");
  assert.equal(call.commandName, "ban");
  assert.equal(call.settings, settings, "the command gets the same settings a slash command would");

  // The panel is left alone: the answer arrives as the command's own message.
  assert.equal(interaction.seen.update.length, 0);
  assert.deepEqual(interaction.seen.defer, [{ ephemeral: false }]);
  assert.deepEqual(interaction.seen.followUp, [{ content: "done" }]);
});

test("running refuses while a required option is empty", async () => {
  const command = slashCommand();
  const interaction = makeInteraction([command], { customId: "CMDP:run:ban" });

  await route(interaction);

  assert.equal(command.ran.length, 0);
  assert.match(interaction.seen.reply[0].content, /user/);
});

test("a command the bot cannot carry out is refused rather than attempted", async () => {
  const command = slashCommand({ botPermissions: ["BanMembers"] });
  draft.write(USER, "ban", "user", TARGET);

  const interaction = makeInteraction([command], { customId: "CMDP:run:ban" });
  interaction.guild.members.me = { permissions: { has: () => false } };

  await route(interaction);

  assert.equal(command.ran.length, 0);
  assert.match(interaction.seen.reply[0].content, /I need/);
});

test("a command somebody may not run is not in their panel at all", async () => {
  const command = slashCommand();
  const interaction = makeInteraction([command], { customId: "CMDP:cmd:ban", permissions: false });

  await route(interaction);

  // Falling back to the catalogue, which for this member is empty.
  assert.match(interaction.seen.update[0].embeds[0].data.title, /Все команды/);
});

test("a command that throws is reported instead of failing silently", async () => {
  const command = slashCommand({
    interactionRun: async () => {
      throw new Error("boom");
    },
  });
  draft.write(USER, "ban", "user", TARGET);

  const interaction = makeInteraction([command], { customId: "CMDP:run:ban" });
  await route(interaction);

  assert.match(interaction.seen.followUp[0].content, /Команда не отработала/);
});

test("a prefix-only command opens its form like any other", async () => {
  const command = prefixCommand();
  const interaction = makeInteraction([command], { customId: "CMDP:cmd:setrr" });

  await route(interaction);

  const [payload] = interaction.seen.update;
  assert.match(payload.embeds[0].data.title, /setrr/, "the command it was asked for, not the catalogue");

  const buttons = payload.components.flatMap((row) => row.components).map((button) => button.data);
  assert.ok(
    buttons.some((button) => button.custom_id === "CMDP:run:setrr"),
    "a command with no slash version is still runnable from its own screen"
  );
});

test("a prefix-only command runs from the panel too", async () => {
  const command = prefixCommand();
  draft.write(USER, "setrr", "args", `<#5> 123 😀 <@&${STAFF_ROLE}>`);

  const interaction = makeInteraction([command], { customId: "CMDP:run:setrr" });
  await route(interaction, { prefix: "?" });

  assert.equal(command.ran.length, 1);
  const [call] = command.ran;
  assert.deepEqual(call.args, ["<#5>", "123", "😀", `<@&${STAFF_ROLE}>`]);
  assert.equal(call.content, `?setrr <#5> 123 😀 <@&${STAFF_ROLE}>`);
  assert.equal(call.prefix, "?");
  assert.equal(call.mentions.roles.first().id, STAFF_ROLE, "mentions are read back out of the arguments");
  assert.deepEqual(interaction.seen.followUp, ["set"]);
});

test("a lost draft leaves the panel usable instead of stuck", async () => {
  const interaction = makeInteraction([slashCommand()], { customId: "CMDP:cmd:nothing-like-this" });

  await route(interaction);

  assert.match(interaction.seen.update[0].embeds[0].data.title, /Все команды/, "it falls back to the catalogue");
});

/* ------------------------------------------------------- real command coverage */

/**
 * Every command file the bot actually ships, loaded the same way BotClient
 * loads them - so this checks the real inventory, not a couple of fixtures.
 */
function loadRealCommands() {
  const { recursiveReadDirSync } = require("@helpers/Utils");
  return recursiveReadDirSync("src/commands")
    .map((file) => require(file))
    .filter((entry) => entry && typeof entry === "object" && typeof entry.name === "string");
}

test("every real command can be seen by the panel - neither surface is left disabled by mistake", () => {
  const commands = loadRealCommands();
  assert.ok(commands.length > 100, "sanity check: this should be the whole command set, not a fragment");

  const invisible = commands.filter((command) => !command.slashCommand?.enabled && !command.command?.enabled);
  assert.deepEqual(
    invisible.map((command) => command.name),
    [],
    "a command with neither surface enabled never reaches catalog.allowed() at all"
  );
});

test("the catalogue's dynamic discovery finds the whole real command set, deduplicated by name", () => {
  const commands = loadRealCommands();
  const client = {
    commands,
    slashCommands: new Map(
      commands.filter((command) => command.slashCommand?.enabled).map((command) => [command.name, command])
    ),
  };

  const found = new Set(catalog.allCommands(client).map((command) => command.name));
  const expected = new Set(commands.map((command) => command.name));
  assert.deepEqual(found, expected);
});

test("an ordinary staff member reaches every real command name except the panel itself and owner-only ones", () => {
  const { OWNER_IDS } = require("@root/config");
  const commands = loadRealCommands();
  const client = {
    commands,
    slashCommands: new Map(
      commands.filter((command) => command.slashCommand?.enabled).map((command) => [command.name, command])
    ),
  };
  const member = { id: "999999999999999999", permissions: { has: () => true } };
  assert.ok(!OWNER_IDS.includes(member.id), "the fixture member must not accidentally be an owner");

  const reachable = new Set(catalog.commandsFor(client, member).map((command) => command.name));
  // A handful of names (e.g. "purge", "invites") are deliberately split across
  // two files - a prefix-only one and a slash-only one sharing a name, so both
  // ?purge and /purge work. The catalogue shows one entry per name, so the
  // expected set is names, not files.
  const uniqueNames = new Set(commands.map((command) => command.name));
  const expectedExcluded = new Set(
    commands
      .filter((command) => command.name === "panel" || command.category === "OWNER")
      .map((command) => command.name)
  );

  for (const name of expectedExcluded) {
    assert.ok(!reachable.has(name), `${name} should not be reachable`);
  }
  assert.equal(reachable.size, uniqueNames.size - expectedExcluded.size);
});
