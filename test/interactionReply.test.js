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
