const test = require("node:test");
const assert = require("node:assert/strict");
require("module-alias/register");
require("@helpers/extenders/Interaction");

const { BaseInteraction } = require("discord.js");

const safeFollowUp = BaseInteraction.prototype.safeFollowUp;

/**
 * Stand-in for an interaction, recording which of the three ways to answer was used.
 *
 * @param {{deferred?: boolean, replied?: boolean, fails?: string}} state
 */
function makeInteraction({ deferred = false, replied = false, fails } = {}) {
  const calls = [];

  const answer = (kind) => async (content) => {
    calls.push({ kind, content });

    if (fails === kind) {
      const error = new Error(kind);
      error.code = kind === "editReply" ? "InteractionNotReplied" : "InteractionAlreadyReplied";
      throw error;
    }

    // discord.js marks the interaction answered; deferred stays true afterwards.
    interaction.replied = true;
    return { id: `message-from-${kind}` };
  };

  const interaction = {
    deferred,
    replied,
    calls,
    client: { logger: { error: () => {} } },
    editReply: answer("editReply"),
    followUp: answer("followUp"),
    reply: answer("reply"),
  };

  return interaction;
}

test("a deferred interaction is edited, not followed up", async () => {
  const interaction = makeInteraction({ deferred: true });

  const message = await safeFollowUp.call(interaction, "done");

  assert.deepEqual(
    interaction.calls.map((call) => call.kind),
    ["editReply"]
  );
  assert.equal(message.id, "message-from-editReply", "the caller still gets a message to watch");
});

test("an untouched interaction is replied to", async () => {
  const interaction = makeInteraction();

  await safeFollowUp.call(interaction, "done");

  assert.deepEqual(
    interaction.calls.map((call) => call.kind),
    ["reply"]
  );
});

test("speaking twice produces two messages instead of overwriting the first", async () => {
  const interaction = makeInteraction({ deferred: true });

  await safeFollowUp.call(interaction, "working on it");
  await safeFollowUp.call(interaction, "finished");

  assert.deepEqual(
    interaction.calls.map((call) => call.kind),
    ["editReply", "followUp"]
  );
  assert.equal(interaction.calls[1].content, "finished");
});

test("an interaction that already replied gets a follow-up", async () => {
  const interaction = makeInteraction({ replied: true, deferred: true });

  await safeFollowUp.call(interaction, "more");

  assert.deepEqual(
    interaction.calls.map((call) => call.kind),
    ["followUp"]
  );
});

test("nothing is sent for empty content", async () => {
  const interaction = makeInteraction({ deferred: true });

  await safeFollowUp.call(interaction, "");

  assert.deepEqual(interaction.calls, []);
});

test("a rejected edit falls back instead of throwing at the command", async () => {
  const interaction = makeInteraction({ deferred: true, fails: "editReply" });

  await assert.doesNotReject(() => safeFollowUp.call(interaction, "done"));
  assert.equal(interaction.calls[0].kind, "editReply");
});

/**
 * A `seconds` arg deletes the answer after that delay, the same convention
 * `Message.safeReply`/`GuildChannel.safeSend` already use - but only when what
 * came back is actually a deletable message, which `editReply`/`followUp`
 * genuinely return and a bare first `reply()` does not.
 */
function makeDeletableInteraction(overrides = {}) {
  const deletions = [];
  const interaction = makeInteraction({ deferred: true, ...overrides });
  interaction.editReply = async (content) => {
    interaction.calls.push({ kind: "editReply", content });
    interaction.replied = true;
    return {
      id: "message-from-editReply",
      deletable: true,
      delete: async () => deletions.push(Date.now()),
    };
  };
  interaction.deletions = deletions;
  return interaction;
}

test("a seconds argument schedules deletion of the answer", async () => {
  const interaction = makeDeletableInteraction();

  await safeFollowUp.call(interaction, "done", 0.01);
  assert.equal(interaction.deletions.length, 0, "not deleted before the delay elapses");

  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(interaction.deletions.length, 1);
});

test("no seconds argument means the answer is left alone", async () => {
  const interaction = makeDeletableInteraction();

  await safeFollowUp.call(interaction, "done");
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(interaction.deletions.length, 0);
});

test("a plain reply() is not deletable, so seconds quietly does nothing there", async () => {
  const interaction = makeInteraction();

  await assert.doesNotReject(() => safeFollowUp.call(interaction, "done", 0.01));
  await new Promise((resolve) => setTimeout(resolve, 20));
  // makeInteraction's reply() returns a plain object with no delete() at all;
  // reaching this line without throwing is the assertion.
});

/* -------------------------------------------------------------- startup gate */

const route = require("@src/events/interactions/interactionCreate");

test("a click during startup is answered instead of left to expire", async () => {
  const replies = [];
  const interaction = {
    customId: "TICKET_CREATE",
    guild: { id: "1" },
    reply: async (payload) => replies.push(payload),
    isButton: () => true,
    isChatInputCommand: () => false,
    isContextMenuCommand: () => false,
    isAnySelectMenu: () => false,
  };

  const client = { startupComplete: false, logger: { warn: () => {} }, telemetry: null };
  await route(client, interaction);

  assert.equal(replies.length, 1, "the interaction is answered while the bot is still booting");
  assert.match(replies[0].content, /starting up/i);
  assert.equal(replies[0].ephemeral, true);
});
