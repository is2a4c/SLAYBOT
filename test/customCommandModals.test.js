const test = require("node:test");
const assert = require("node:assert/strict");
require("module-alias/register");

const modalSessions = require("@src/services/customCommands/modalSessions");
const { buildModal, modalCustomId, parseModalCustomId } = require("@src/services/customCommands/modalBuilder");
const {
  accessProblem,
  handleModalSubmit,
  matchesModal,
  presentModal,
  renderTemplate,
  resetCooldowns,
  runFromInteraction,
} = require("@src/services/customCommands/CustomCommandRuntime");
const {
  CustomCommandError,
  actionFromInput,
  parseModalInputs,
  updateCommand,
} = require("../dashboard/services/customCommands");
const { MAX_MODAL_INPUTS } = require("@schemas/CustomCommand");

const GUILD_ID = "100000000000000000";
const CHANNEL_ID = "100000000000000001";
const ROLE_ID = "100000000000000002";
const USER_ID = "100000000000000003";

test.beforeEach(() => {
  modalSessions.reset();
  resetCooldowns();
});

/* -------------------------------------------------------------------- guild */

function testGuild() {
  return {
    id: GUILD_ID,
    name: "Test Server",
    channels: { cache: new Map([[CHANNEL_ID, { id: CHANNEL_ID, isTextBased: () => true, isThread: () => false }]]) },
    roles: { cache: new Map([[ROLE_ID, { id: ROLE_ID, managed: false, editable: true }]]) },
  };
}

/**
 * A ChatInputCommandInteraction or ModalSubmitInteraction good enough for the
 * runtime: it tracks its own reply/defer state the way Discord's really does,
 * so a bug that shows a modal after deferring, or replies twice, shows up as a
 * wrong call rather than being quietly accepted.
 */
function testInteraction(overrides = {}) {
  const seen = { reply: [], defer: [], edit: [], followUp: [], modal: [] };
  const guild = testGuild();
  const channel = guild.channels.cache.get(CHANNEL_ID);
  const sentToChannel = [];
  channel.send = async (payload) => {
    sentToChannel.push(payload);
    return { id: "sent-1", delete: async () => {} };
  };

  const memberRoleCalls = [];
  const member = {
    id: USER_ID,
    guild,
    displayName: "Tester",
    roles: {
      cache: new Map([[ROLE_ID, { id: ROLE_ID }]]),
      add: async (ids) => memberRoleCalls.push(["add", ids]),
      remove: async (ids) => memberRoleCalls.push(["remove", ids]),
    },
    send: async (payload) => {
      seen.dm = seen.dm || [];
      seen.dm.push(payload);
      return payload;
    },
  };

  const interaction = {
    seen,
    memberRoleCalls,
    sentToChannel,
    id: "int-1",
    guildId: GUILD_ID,
    guild,
    channel,
    channelId: CHANNEL_ID,
    member,
    user: { id: USER_ID },
    commandName: "greet",
    deferred: false,
    replied: false,
    client: { logger: { error: () => {} } },
    options: { getSubcommand: () => null, data: [] },
    isMessageContextMenuCommand: () => false,
    fields: { getTextInputValue: () => "" },
    customId: "",
    ...overrides,
  };

  interaction.deferReply = async (payload) => {
    seen.defer.push(payload);
    interaction.deferred = true;
  };
  interaction.reply = async (payload) => {
    seen.reply.push(payload);
    interaction.replied = true;
  };
  interaction.editReply = async (payload) => {
    seen.edit.push(payload);
  };
  interaction.followUp = async (payload) => {
    seen.followUp.push(payload);
  };
  interaction.safeFollowUp = async (payload) => {
    if (interaction.replied) return interaction.followUp(payload);
    if (interaction.deferred) return interaction.editReply(payload);
    return interaction.reply(payload);
  };
  interaction.showModal = async (modal) => {
    seen.modal.push(modal);
    interaction.replied = true;
  };

  return interaction;
}

function modalCommand(overrides = {}) {
  return {
    _id: "cmd-1",
    guild_id: GUILD_ID,
    name: "greet",
    enabled: true,
    cooldown_seconds: 0,
    delete_invocation: false,
    allowed_roles: [],
    allowed_channels: [],
    triggers: { prefix: false, slash: true, message_context: false, member_context: false },
    actions: [
      {
        id: "confirm-1",
        name: "say hi",
        type: "SEND_MESSAGE",
        content: "Hi {modal:name}, you said {modal:color}!",
        embed_title: null,
        embed_description: null,
        embed_color: null,
        channel_id: null,
        tts: false,
        delete_after_seconds: 0,
        mention_roles: [],
      },
      {
        id: "modal-1",
        name: "form",
        type: "SHOW_MODAL",
        modal_title: "Say hi",
        modal_inputs: [
          { id: "name", label: "Your name", style: "SHORT", required: true, min_length: null, max_length: null, placeholder: null },
          { id: "color", label: "Favourite colour", style: "SHORT", required: false, min_length: null, max_length: null, placeholder: null },
        ],
        confirm_action_id: "confirm-1",
      },
    ],
    ...overrides,
  };
}

function fakeModel(commands) {
  return { findOne: async (query) => commands.find((c) => c._id === query._id && c.guild_id === query.guild_id && (!query.enabled || c.enabled)) || null };
}

/* ------------------------------------------------------------- modalBuilder */

test("a modal's custom id round-trips through parseModalCustomId", () => {
  const id = modalCustomId("abc-123");
  assert.equal(parseModalCustomId(id), "abc-123");
  assert.equal(parseModalCustomId("SOMETHING_ELSE:abc-123"), null, "a foreign custom id is never mistaken for ours");
});

test("buildModal turns the stored fields into Discord's own components", () => {
  const action = modalCommand().actions.find((entry) => entry.type === "SHOW_MODAL");
  const modal = buildModal(action, "token-1").toJSON();

  assert.equal(modal.custom_id, "CCMODAL:token-1");
  assert.equal(modal.title, "Say hi");
  assert.equal(modal.components.length, 2, "one row per field, one field per row");

  const [nameInput] = modal.components[0].components;
  assert.equal(nameInput.custom_id, "name");
  assert.equal(nameInput.required, true);

  const [colorInput] = modal.components[1].components;
  assert.equal(colorInput.required, false);
});

test("more than five fields never reaches Discord, even from a hand-built action", () => {
  const tooMany = {
    modal_title: "x",
    modal_inputs: Array.from({ length: 8 }, (_, i) => ({ id: `f${i}`, label: `f${i}`, style: "SHORT", required: true })),
  };
  const modal = buildModal(tooMany, "token-2").toJSON();
  assert.equal(modal.components.length, MAX_MODAL_INPUTS);
});

/* ------------------------------------------------------------- modalSessions */

test("a session is answered once: the second read finds nothing", () => {
  const token = modalSessions.create({ guildId: GUILD_ID, commandId: "cmd-1", userId: USER_ID, args: [], options: {}, target: null });
  assert.equal(modalSessions.size(), 1);

  const first = modalSessions.consume(token, USER_ID);
  assert.ok(first);
  assert.equal(modalSessions.size(), 0);

  const second = modalSessions.consume(token, USER_ID);
  assert.equal(second, null, "a resubmission finds nothing to run, rather than running the action again");
});

test("a session opened for somebody else refuses, and still burns the token", () => {
  const token = modalSessions.create({ guildId: GUILD_ID, commandId: "cmd-1", userId: USER_ID, args: [], options: {}, target: null });
  assert.equal(modalSessions.consume(token, "someone-else"), null);
  assert.equal(modalSessions.consume(token, USER_ID), null, "already consumed by the ownership check above");
});

test("a session past its TTL is treated as gone", () => {
  const token = modalSessions.create({ guildId: GUILD_ID, commandId: "cmd-1", userId: USER_ID, args: [], options: {}, target: null });

  const realNow = Date.now;
  try {
    Date.now = () => realNow() + modalSessions.TTL_MS + 1000;
    assert.equal(modalSessions.consume(token, USER_ID), null);
  } finally {
    Date.now = realNow;
  }
});

test("discard burns a token that was never actually shown to anybody", () => {
  const token = modalSessions.create({ guildId: GUILD_ID, commandId: "cmd-1", userId: USER_ID, args: [], options: {}, target: null });
  modalSessions.discard(token);
  assert.equal(modalSessions.consume(token, USER_ID), null);
});

/* -------------------------------------------------------- runtime: opening */

test("presentModal shows the form as the interaction's first and only answer", async () => {
  const command = modalCommand();
  const interaction = testInteraction();
  const modalAction = command.actions.find((entry) => entry.type === "SHOW_MODAL");

  const result = await presentModal(interaction, command, modalAction, { args: ["hi"], options: { greeting: "hi" } });

  assert.equal(interaction.seen.modal.length, 1);
  assert.equal(interaction.seen.defer.length, 0, "showModal cannot follow a deferral");
  assert.equal(interaction.seen.reply.length, 0);
  assert.equal(result.presentedModal, true);
  assert.equal(modalSessions.size(), 1, "the session waits for the submission");
});

test("runFromInteraction shows the form instead of running the command straight through", async () => {
  const command = modalCommand();
  const interaction = testInteraction();

  await runFromInteraction(interaction, command, {});

  assert.equal(interaction.seen.modal.length, 1);
  assert.equal(interaction.seen.defer.length, 0);
  assert.equal(interaction.sentToChannel.length, 0, "the confirm action has not run yet");
});

test("a channel or role restriction refuses before the form is even shown", async () => {
  const command = modalCommand({ allowed_channels: ["999999999999999999"] });
  const interaction = testInteraction();

  const result = await presentModal(interaction, command, command.actions[1], {});

  assert.equal(interaction.seen.modal.length, 0);
  assert.match(interaction.seen.reply[0].content, /not available in this channel/);
  assert.equal(result.executed, false);
  assert.equal(modalSessions.size(), 0, "nothing was opened, so nothing needs to be waited for");
});

test("opening the form starts its cooldown", async () => {
  const command = modalCommand({ cooldown_seconds: 30 });
  const first = testInteraction();
  await presentModal(first, command, command.actions[1], {});

  const second = testInteraction();
  const problem = accessProblem(command, second);
  assert.match(problem, /cooldown/);
});

test("Discord refusing to open the form discards the session instead of leaving it stranded", async () => {
  const command = modalCommand();
  const interaction = testInteraction();
  interaction.showModal = async () => {
    throw new Error("Invalid Form Body");
  };

  const result = await presentModal(interaction, command, command.actions[1], {});

  assert.equal(result.executed, false);
  assert.equal(modalSessions.size(), 0);
});

/* ------------------------------------------------------ runtime: submitting */

test("submitting the form runs its confirmation action with the typed values", async () => {
  const command = modalCommand();
  const opener = testInteraction();
  await presentModal(opener, command, command.actions[1], { args: [], options: {} });
  const token = parseModalCustomId(opener.seen.modal[0].data.custom_id);

  const values = { name: "Ada", color: "purple" };
  const submit = testInteraction({
    customId: modalCustomId(token),
    fields: { getTextInputValue: (id) => values[id] || "" },
  });

  const result = await handleModalSubmit(submit, { model: fakeModel([command]) });

  assert.equal(result.handled, true);
  assert.equal(result.executed, true);
  assert.equal(submit.sentToChannel.length, 1);
  assert.equal(submit.sentToChannel[0].content, "Hi Ada, you said purple!");
});

test("submitting twice runs the action once: the second attempt finds an expired form", async () => {
  const command = modalCommand();
  const opener = testInteraction();
  await presentModal(opener, command, command.actions[1], {});
  const token = parseModalCustomId(opener.seen.modal[0].data.custom_id);

  const first = testInteraction({ customId: modalCustomId(token) });
  await handleModalSubmit(first, { model: fakeModel([command]) });
  assert.equal(first.sentToChannel.length, 1);

  const second = testInteraction({ customId: modalCustomId(token) });
  await handleModalSubmit(second, { model: fakeModel([command]) });

  assert.equal(second.sentToChannel.length, 0, "nothing ran the second time");
  assert.match(second.seen.reply[0].content, /expired or was already submitted/);
});

test("a token this bot never issued gets the same expired answer, not a crash", async () => {
  const interaction = testInteraction({ customId: modalCustomId("never-issued") });
  const result = await handleModalSubmit(interaction, { model: fakeModel([]) });

  assert.equal(result, undefined, "the reply promise resolves; nothing throws");
  assert.match(interaction.seen.reply[0].content, /expired or was already submitted/);
});

test("a command deleted or disabled between opening and submitting fails safely", async () => {
  const command = modalCommand();
  const opener = testInteraction();
  await presentModal(opener, command, command.actions[1], {});
  const token = parseModalCustomId(opener.seen.modal[0].data.custom_id);

  const submit = testInteraction({ customId: modalCustomId(token) });
  await handleModalSubmit(submit, { model: fakeModel([]) });

  assert.match(submit.seen.reply[0].content, /no longer available/);
});

test("a form with nothing to confirm still acknowledges the submission", async () => {
  const command = modalCommand();
  command.actions[1].confirm_action_id = null;
  const opener = testInteraction();
  await presentModal(opener, command, command.actions[1], {});
  const token = parseModalCustomId(opener.seen.modal[0].data.custom_id);

  const submit = testInteraction({ customId: modalCustomId(token) });
  const result = await handleModalSubmit(submit, { model: fakeModel([command]) });

  assert.equal(result.executed, false);
  assert.equal(submit.seen.edit[0].content, "Done.", "the submission is still acknowledged, even with nothing to run");
});

test("matchesModal only claims custom ids this feature actually issued", () => {
  assert.equal(matchesModal("CCMODAL:abc"), true);
  assert.equal(matchesModal("FORM_MODAL:abc"), false);
  assert.equal(matchesModal(""), false);
});

test("{modal:*} substitutes what was typed and nothing more", () => {
  const context = {
    guild: { name: "G" },
    member: { id: "1", displayName: "T" },
    channel: { id: "2" },
    arguments: [],
    options: {},
    modal: { note: "hello {member:id}" },
  };
  // A value typed into a form is data, not another round of substitution: a
  // submitted string that happens to look like a variable is not expanded again.
  assert.equal(renderTemplate("Note: {modal:note}", context), "Note: hello {member:id}");
});

/* --------------------------------------------------------- dashboard: input */

test("parseModalInputs reads the compact line format", () => {
  const inputs = parseModalInputs("name | Your name | short | required\ncolor | Favourite colour | paragraph | optional | 2 | 20 | e.g. blue");
  assert.deepEqual(inputs, [
    { id: "name", label: "Your name", style: "SHORT", required: true, min_length: null, max_length: null, placeholder: null },
    { id: "color", label: "Favourite colour", style: "PARAGRAPH", required: false, min_length: 2, max_length: 20, placeholder: "e.g. blue" },
  ]);
});

test("parseModalInputs rejects what Discord could never accept", () => {
  assert.throws(() => parseModalInputs("| no id"), CustomCommandError);
  assert.throws(() => parseModalInputs("name | n\nname | n again"), /used twice/);
  assert.throws(() => parseModalInputs("name | n | short | required | 10 | 2"), /minimum length cannot exceed/);
  assert.throws(
    () => parseModalInputs(Array.from({ length: MAX_MODAL_INPUTS + 1 }, (_, i) => `f${i} | f${i}`).join("\n")),
    /at most 5 fields/
  );
});

test("actionFromInput refuses a form on a command with no way to open one", () => {
  const guild = testGuild();
  const prefixOnly = { actions: [], triggers: { prefix: true, slash: false, message_context: false, member_context: false } };

  assert.throws(
    () => actionFromInput(guild, { type: "SHOW_MODAL", modalTitle: "x", modalInputs: "a | a" }, prefixOnly),
    /Enable a slash or context menu trigger/
  );
});

test("actionFromInput allows only one form per command", () => {
  const guild = testGuild();
  const command = { actions: [{ type: "SHOW_MODAL" }], triggers: { slash: true } };

  assert.throws(
    () => actionFromInput(guild, { type: "SHOW_MODAL", modalTitle: "x", modalInputs: "a | a" }, command),
    /only have one form/
  );
});

test("actionFromInput wires the chosen action up as the confirmation step", () => {
  const guild = testGuild();
  const command = { actions: [{ id: "existing-1", type: "SEND_MESSAGE" }], triggers: { slash: true } };

  const action = actionFromInput(
    guild,
    { type: "SHOW_MODAL", actionName: "form", modalTitle: "Say hi", modalInputs: "name | Your name", confirmAction: "existing-1" },
    command
  );

  assert.equal(action.type, "SHOW_MODAL");
  assert.equal(action.confirm_action_id, "existing-1");
  assert.equal(action.modal_title, "Say hi");
  assert.equal(action.modal_inputs.length, 1);
});

test("a confirmation action id that does not exist is simply not wired up", () => {
  const guild = testGuild();
  const command = { actions: [], triggers: { slash: true } };

  const action = actionFromInput(
    guild,
    { type: "SHOW_MODAL", modalTitle: "x", modalInputs: "a | a", confirmAction: "not-real" },
    command
  );

  assert.equal(action.confirm_action_id, null);
});

test("updateCommand will not let a form-bearing command fall back to the prefix", async () => {
  const guild = testGuild();
  const command = {
    name: "greet",
    actions: [{ type: "SHOW_MODAL" }],
    save: async () => {},
  };
  const commandModel = { findOne: async () => command };

  await assert.rejects(
    () =>
      updateCommand(
        guild,
        "aaaaaaaaaaaaaaaaaaaaaaaa",
        { name: "greet", triggerPrefix: "on" },
        { getCommand: () => null },
        commandModel
      ),
    /needs a slash or context menu trigger/
  );
});
