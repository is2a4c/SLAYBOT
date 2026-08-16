const test = require("node:test");
const assert = require("node:assert/strict");
require("module-alias/register");

const { ApplicationCommandOptionType, ApplicationCommandType, Collection } = require("discord.js");
const {
  chatInputPayload,
  contextLabel,
  desiredRegistrations,
  matchesExisting,
  optionPayload,
  reservedNames,
  syncGuildCommands,
  unpublishCommand,
} = require("@src/services/customCommands/applicationCommands");
const { OPTION_TYPES } = require("@schemas/CustomCommand");
const { optionFromInput, optionHost, parseChoices } = require("../dashboard/services/customCommands");
const { readSlashOptions } = require("@src/services/customCommands/CustomCommandRuntime");

const GUILD_ID = "100000000000000000";

function command(overrides = {}) {
  return {
    name: "hello",
    description: "says hello",
    enabled: true,
    triggers: { prefix: true, slash: false, message_context: false, member_context: false },
    context_label: null,
    options: [],
    subcommands: [],
    registrations: [],
    ...overrides,
  };
}

/**
 * A guild whose application commands can be read, created, edited and deleted,
 * recording every call so the reconciliation can be checked against it.
 */
function mockGuild(existing = [], { failCreate = false } = {}) {
  const calls = { created: [], edited: [], deleted: [] };
  const published = new Collection();

  const wrap = (entry) => ({
    ...entry,
    edit: async (payload) => {
      calls.edited.push([entry.id, payload.name]);
      const next = wrap({ ...entry, ...payload });
      published.set(entry.id, next);
      return next;
    },
    delete: async () => {
      calls.deleted.push(entry.id);
      published.delete(entry.id);
      return entry;
    },
  });

  for (const entry of existing) published.set(entry.id, wrap(entry));

  let nextId = 900;
  return {
    calls,
    published,
    id: GUILD_ID,
    client: { slashCommands: new Collection(), commands: [], contextMenus: new Collection() },
    commands: {
      fetch: async () => published,
      create: async (payload) => {
        if (failCreate) throw new Error("Invalid Form Body");
        const created = wrap({ id: String(++nextId), ...payload });
        calls.created.push(payload.name);
        published.set(created.id, created);
        return created;
      },
      delete: async (id) => {
        calls.deleted.push(id);
        published.delete(id);
      },
    },
  };
}

/* ------------------------------------------------------------------ payloads */

test("a command with no subcommands publishes its own parameters", () => {
  const payload = chatInputPayload(
    command({
      options: [{ name: "target", description: "who", type: OPTION_TYPES.USER, required: true, choices: [] }],
    })
  );

  assert.equal(payload.type, ApplicationCommandType.ChatInput);
  assert.equal(payload.description, "says hello");
  assert.deepEqual(payload.options, [{ name: "target", description: "who", type: OPTION_TYPES.USER, required: true }]);
});

test("subcommands replace the root parameters entirely", () => {
  const payload = chatInputPayload(
    command({
      options: [{ name: "ignored", description: "x", type: OPTION_TYPES.STRING, choices: [] }],
      subcommands: [
        {
          name: "add",
          description: "adds",
          options: [{ name: "n", description: "count", type: OPTION_TYPES.INTEGER, choices: [] }],
        },
      ],
    })
  );

  assert.equal(payload.options.length, 1);
  assert.equal(payload.options[0].name, "add");
  assert.equal(payload.options[0].type, 1, "Discord's subcommand type");
  assert.equal(payload.options[0].options[0].name, "n");
});

test("a command with no description still publishes, since Discord demands one", () => {
  assert.equal(chatInputPayload(command({ description: null })).description, "Custom command hello");
});

test("choice values are typed the way their option is", () => {
  const text = optionPayload({
    name: "size",
    description: "s",
    type: OPTION_TYPES.STRING,
    choices: [{ name: "S", value: "1" }],
  });
  const number = optionPayload({
    name: "size",
    description: "s",
    type: OPTION_TYPES.INTEGER,
    choices: [{ name: "S", value: "1" }],
  });

  assert.equal(text.choices[0].value, "1");
  assert.equal(number.choices[0].value, 1);

  const noChoices = optionPayload({
    name: "who",
    description: "w",
    type: OPTION_TYPES.USER,
    choices: [{ name: "S", value: "1" }],
  });
  assert.equal(noChoices.choices, undefined, "Discord takes choices only on the value types");
});

test("a numeric range publishes only for number types, a length range only for text", () => {
  const bounded = optionPayload({
    name: "level",
    description: "l",
    type: OPTION_TYPES.INTEGER,
    min_value: 1,
    max_value: 100,
  });
  assert.deepEqual([bounded.min_value, bounded.max_value], [1, 100]);

  const text = optionPayload({
    name: "note",
    description: "n",
    type: OPTION_TYPES.STRING,
    min_length: 5,
    max_length: 50,
  });
  assert.deepEqual([text.min_length, text.max_length], [5, 50]);

  const unbounded = optionPayload({
    name: "who",
    description: "w",
    type: OPTION_TYPES.USER,
    min_value: 1,
    min_length: 5,
  });
  assert.deepEqual(
    [unbounded.min_value, unbounded.max_value, unbounded.min_length, unbounded.max_length],
    [undefined, undefined, undefined, undefined],
    "a range on a type that cannot take one is simply not published"
  );
});

test("a context entry falls back to the command name for its label", () => {
  assert.equal(contextLabel(command()), "hello");
  assert.equal(contextLabel(command({ context_label: "Say hello" })), "Say hello");
});

test("a disabled command wants nothing published", () => {
  const off = command({ enabled: false, triggers: { slash: true, message_context: true } });
  assert.deepEqual(desiredRegistrations(off), []);
});

test("each trigger asks for its own kind of entry", () => {
  const wanted = desiredRegistrations(
    command({ triggers: { slash: true, message_context: true, member_context: true } })
  );

  assert.deepEqual(
    wanted.map((entry) => entry.type),
    [ApplicationCommandType.ChatInput, ApplicationCommandType.Message, ApplicationCommandType.User]
  );
});

/* ------------------------------------------------------------ reconciliation */

test("publishing creates what is missing and records the id", async () => {
  const guild = mockGuild();
  const saved = [];
  const entry = command({
    triggers: { slash: true },
    save: async function () {
      saved.push(this.registrations);
    },
  });

  const result = await syncGuildCommands({ guild, commands: [entry] });

  assert.deepEqual(result.created, ["hello"]);
  assert.equal(saved.length, 1);
  assert.equal(entry.registrations[0].command_id, "901");
});

test("an unchanged command costs no call at all", async () => {
  const guild = mockGuild([
    { id: "901", type: ApplicationCommandType.ChatInput, name: "hello", description: "says hello", options: [] },
  ]);
  const entry = command({
    triggers: { slash: true },
    registrations: [{ type: ApplicationCommandType.ChatInput, name: "hello", command_id: "901" }],
    save: async () => assert.fail("nothing changed, so nothing should be written"),
  });

  const result = await syncGuildCommands({ guild, commands: [entry] });

  assert.deepEqual([result.created, result.updated, result.removed], [[], [], []]);
  assert.deepEqual(guild.calls, { created: [], edited: [], deleted: [] });
});

test("switching a trigger off takes its entry down, and only its own", async () => {
  const guild = mockGuild([
    { id: "901", type: ApplicationCommandType.ChatInput, name: "hello", description: "says hello", options: [] },
    { id: "500", type: ApplicationCommandType.ChatInput, name: "ban", description: "a built-in", options: [] },
  ]);
  const entry = command({
    triggers: { prefix: true },
    registrations: [{ type: ApplicationCommandType.ChatInput, name: "hello", command_id: "901" }],
    save: async () => {},
  });

  const result = await syncGuildCommands({ guild, commands: [entry] });

  assert.deepEqual(result.removed, ["hello"]);
  assert.deepEqual(guild.calls.deleted, ["901"]);
  assert.ok(guild.published.has("500"), "a command the bot did not publish is never touched");
  assert.deepEqual(entry.registrations, []);
});

test("a name a built-in already holds is refused rather than published over it", async () => {
  const guild = mockGuild();
  guild.client.slashCommands.set("hello", { name: "hello" });

  const result = await syncGuildCommands({
    guild,
    commands: [command({ triggers: { slash: true }, save: async () => {} })],
  });

  assert.deepEqual(result.conflicts, ["hello: hello"]);
  assert.deepEqual(guild.calls.created, []);
});

test("two commands claiming one name leave the second unpublished", async () => {
  const guild = mockGuild();
  const first = command({ name: "hello", triggers: { slash: true }, save: async () => {} });
  const second = command({ name: "greet", context_label: "hello", triggers: { slash: true }, save: async () => {} });
  second.name = "hello";

  const result = await syncGuildCommands({ guild, commands: [first, second] });

  assert.deepEqual(result.created, ["hello"]);
  assert.equal(result.conflicts.length, 1);
});

test("Discord refusing a command leaves the working one in place", async () => {
  const guild = mockGuild([], { failCreate: true });
  const warnings = [];
  const entry = command({ triggers: { slash: true }, save: async () => {} });

  const result = await syncGuildCommands({
    guild,
    commands: [entry],
    logger: { warn: (line) => warnings.push(line) },
  });

  assert.deepEqual(result.failed, ["hello"]);
  assert.equal(warnings.length, 1);
  assert.deepEqual(entry.registrations, [], "a refused command is not recorded as published");
});

test("a guild whose commands cannot be read changes nothing", async () => {
  const guild = mockGuild();
  guild.commands.fetch = async () => {
    throw new Error("Missing Access");
  };

  const result = await syncGuildCommands({
    guild,
    commands: [command({ triggers: { slash: true } })],
    logger: { warn: () => {} },
  });

  assert.deepEqual(result.failed, ["fetch"]);
  assert.deepEqual(guild.calls.created, []);
});

test("deleting a command takes its published entries with it", async () => {
  const guild = mockGuild([{ id: "901", type: ApplicationCommandType.ChatInput, name: "hello" }]);
  const removed = await unpublishCommand(
    guild,
    command({ registrations: [{ type: ApplicationCommandType.ChatInput, name: "hello", command_id: "901" }] })
  );

  assert.deepEqual(removed, ["hello"]);
  assert.deepEqual(guild.calls.deleted, ["901"]);
});

test("an entry Discord has already lost does not stop the rest coming down", async () => {
  const guild = mockGuild([{ id: "902", type: ApplicationCommandType.ChatInput, name: "second" }]);
  guild.commands.delete = async (id) => {
    if (id === "901") throw new Error("Unknown application command");
    guild.calls.deleted.push(id);
  };

  const removed = await unpublishCommand(
    guild,
    command({
      registrations: [
        { type: ApplicationCommandType.ChatInput, name: "gone", command_id: "901" },
        { type: ApplicationCommandType.ChatInput, name: "second", command_id: "902" },
      ],
    }),
    { warn: () => {} }
  );

  assert.deepEqual(removed, ["second"]);
});

test("the reserved names cover slash commands, prefix commands and context menus", () => {
  const reserved = reservedNames({
    slashCommands: new Collection([["ban", { name: "ban" }]]),
    commands: [{ name: "purge" }],
    contextMenus: new Collection([["Report", { name: "Report", type: ApplicationCommandType.Message }]]),
  });

  assert.ok(reserved.get(ApplicationCommandType.ChatInput).has("ban"));
  assert.ok(reserved.get(ApplicationCommandType.ChatInput).has("purge"));
  assert.ok(reserved.get(ApplicationCommandType.Message).has("Report"));
});

test("an existing command is compared by everything Discord would show", () => {
  const payload = chatInputPayload(
    command({ options: [{ name: "who", description: "w", type: OPTION_TYPES.USER, required: true, choices: [] }] })
  );

  assert.equal(matchesExisting({ ...payload, options: [...payload.options] }, payload), true);
  assert.equal(matchesExisting({ ...payload, description: "different" }, payload), false);
  assert.equal(matchesExisting({ ...payload, options: [] }, payload), false);
  assert.equal(matchesExisting(null, payload), false);
});

test("a changed numeric range counts as a real difference, not a cosmetic one", () => {
  const withRange = chatInputPayload(
    command({
      options: [
        {
          name: "level",
          description: "l",
          type: OPTION_TYPES.INTEGER,
          required: true,
          choices: [],
          min_value: 1,
          max_value: 10,
        },
      ],
    })
  );
  const widened = chatInputPayload(
    command({
      options: [
        {
          name: "level",
          description: "l",
          type: OPTION_TYPES.INTEGER,
          required: true,
          choices: [],
          min_value: 1,
          max_value: 20,
        },
      ],
    })
  );

  assert.equal(matchesExisting({ ...withRange, options: [...withRange.options] }, withRange), true);
  assert.equal(matchesExisting(withRange, widened), false);
});

/* ------------------------------------------------------------- dashboard input */

test("a parameter name must be something Discord accepts", () => {
  assert.throws(() => optionFromInput({ optionName: "Not Valid", optionType: "3" }), /lowercase/);
  assert.throws(() => optionFromInput({ optionName: "size", optionType: "99" }), /parameter type/);

  const option = optionFromInput({ optionName: " SIZE ", optionType: "3", optionRequired: "on" });
  assert.equal(option.name, "size");
  assert.equal(option.required, true);
  assert.equal(option.description, "size", "a parameter without a description borrows its own name");
});

test("a numeric parameter's min/max is bounded and typed, a text parameter's range only bounds length", () => {
  const level = optionFromInput({ optionName: "level", optionType: "4", optionMin: "1.9", optionMax: "10.4" });
  assert.deepEqual([level.min_value, level.max_value], [1, 10], "an integer parameter's range is truncated");

  const rating = optionFromInput({ optionName: "rating", optionType: "10", optionMin: "0.5", optionMax: "9.5" });
  assert.deepEqual([rating.min_value, rating.max_value], [0.5, 9.5], "a number parameter's range keeps its fraction");

  assert.throws(
    () => optionFromInput({ optionName: "level", optionType: "4", optionMin: "10", optionMax: "1" }),
    /minimum cannot exceed its maximum/
  );

  const note = optionFromInput({ optionName: "note", optionType: "3", optionMinLength: "5", optionMaxLength: "50" });
  assert.deepEqual([note.min_length, note.max_length], [5, 50]);
  assert.equal(note.min_value, null, "length bounds do not leak into the numeric range fields");

  assert.throws(
    () => optionFromInput({ optionName: "note", optionType: "3", optionMinLength: "50", optionMaxLength: "5" }),
    /minimum length cannot exceed its maximum length/
  );

  const who = optionFromInput({ optionName: "who", optionType: "6", optionMin: "1", optionMinLength: "5" });
  assert.deepEqual(
    [who.min_value, who.max_value, who.min_length, who.max_length],
    [null, null, null, null],
    "a range typed for the wrong parameter kind is simply not stored"
  );
});

test("choices are read one per line and dropped when the type cannot take them", () => {
  assert.deepEqual(parseChoices("Small = 1\nLarge = 2", OPTION_TYPES.STRING), [
    { name: "Small", value: "1" },
    { name: "Large", value: "2" },
  ]);
  assert.deepEqual(parseChoices("Small = nope", OPTION_TYPES.INTEGER), [], "a number option cannot offer text");
  assert.deepEqual(parseChoices("Small = 1", OPTION_TYPES.USER), []);
  assert.deepEqual(parseChoices("Plain", OPTION_TYPES.STRING), [{ name: "Plain", value: "Plain" }]);
});

test("parameters and subcommands stay mutually exclusive", () => {
  assert.throws(() => optionHost({ options: [], subcommands: [{ name: "add", options: [] }] }), /cannot also take/);
  assert.throws(() => optionHost({ options: [], subcommands: [] }, "missing"), /no longer exists/);

  const host = optionHost({ options: [], subcommands: [{ name: "add", options: [] }] }, "add");
  assert.deepEqual(host, []);
});

/* ------------------------------------------------------------------- runtime */

test("a slash invocation is read into arguments and named parameters", () => {
  const interaction = {
    options: {
      getSubcommand: () => null,
      data: [
        { name: "who", value: "100000000000000003" },
        { name: "count", value: 3 },
      ],
    },
  };

  assert.deepEqual(readSlashOptions(interaction), {
    subcommand: null,
    options: { who: "100000000000000003", count: "3" },
    args: ["100000000000000003", "3"],
  });
});

test("a subcommand invocation reads the options nested under it, and leads with its name", () => {
  const interaction = {
    options: {
      getSubcommand: () => "add",
      data: [{ name: "add", options: [{ name: "count", value: 2 }] }],
    },
  };

  assert.deepEqual(readSlashOptions(interaction), {
    subcommand: "add",
    options: { count: "2" },
    args: ["add", "2"],
  });
});

test("user, channel, and role options read back as mentions, not raw ids", () => {
  const interaction = {
    options: {
      getSubcommand: () => null,
      data: [
        { name: "member", type: ApplicationCommandOptionType.User, value: "1", user: { id: "1" } },
        { name: "room", type: ApplicationCommandOptionType.Channel, value: "2", channel: { id: "2" } },
        { name: "team", type: ApplicationCommandOptionType.Role, value: "3", role: { id: "3" } },
      ],
    },
  };

  assert.deepEqual(readSlashOptions(interaction).options, {
    member: "<@1>",
    room: "<#2>",
    team: "<@&3>",
  });
});

test("an attachment option reads back as its url, not the attachment's own id", () => {
  const interaction = {
    options: {
      getSubcommand: () => null,
      data: [
        {
          name: "proof",
          type: ApplicationCommandOptionType.Attachment,
          value: "900000000000000001",
          attachment: { id: "900000000000000001", url: "https://cdn.discordapp.com/attachments/1/2/proof.png" },
        },
      ],
    },
  };

  assert.equal(readSlashOptions(interaction).options.proof, "https://cdn.discordapp.com/attachments/1/2/proof.png");
});

test("a mentionable option reads as a role mention when a role was picked, a user mention otherwise", () => {
  const rolePick = {
    options: {
      getSubcommand: () => null,
      data: [{ name: "who", type: ApplicationCommandOptionType.Mentionable, value: "9", role: { id: "9" } }],
    },
  };
  assert.equal(readSlashOptions(rolePick).options.who, "<@&9>");

  const userPick = {
    options: {
      getSubcommand: () => null,
      data: [{ name: "who", type: ApplicationCommandOptionType.Mentionable, value: "9", user: { id: "9" } }],
    },
  };
  assert.equal(readSlashOptions(userPick).options.who, "<@9>");
});
