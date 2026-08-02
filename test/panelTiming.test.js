const test = require("node:test");
const assert = require("node:assert/strict");
require("module-alias/register");

const { ack, ackIfSlow, expired, redraw, warn } = require("@src/services/panels/reply");
const { defineCollectionPanel } = require("@src/services/panels/collectionPanel");
const { buildHub, handle, matches } = require("@src/handlers/controlPanel");
const draft = require("@src/services/panels/draft");
const { translate } = require("@src/i18n");

/**
 * Discord gives three seconds to acknowledge a click. These are the paths that do
 * work before they can draw anything — reading a collection, counting what each
 * system holds, looking the guild settings up after a restart — and the point of
 * each test is that the click is acknowledged before that work starts, not after.
 */

const t = (key, vars) => translate("ru", key, vars);
const USER = "100000000000000001";

/**
 * @param {{customId?: string, values?: string[], manageGuild?: boolean}} input
 */
function makeInteraction({ customId = "TIMING:list", values, manageGuild = true } = {}) {
  const seen = { drawn: [], reply: [], followUp: [], defer: 0 };

  const interaction = {
    customId,
    values,
    seen,
    deferred: false,
    replied: false,
    user: { id: USER },
    client: { user: { username: "SLAYBOT" } },
    member: { permissions: { has: () => manageGuild } },
    guild: { id: "9", preferredLocale: "ru", channels: { cache: new Map() }, roles: { cache: new Map() } },
    update: async (payload) => {
      interaction.replied = true;
      seen.drawn.push({ how: "update", payload });
    },
    editReply: async (payload) => seen.drawn.push({ how: "edit", payload }),
    deferUpdate: async () => {
      interaction.deferred = true;
      seen.defer += 1;
    },
    reply: async (payload) => {
      interaction.replied = true;
      seen.reply.push(payload);
    },
    followUp: async (payload) => seen.followUp.push(payload),
  };

  return interaction;
}

/**
 * A promise somebody else decides when to settle.
 */
function deferred() {
  let release;
  const promise = new Promise((resolve) => (release = resolve));
  return { promise, release };
}

/**
 * A list panel whose storage is as slow as the test wants it to be.
 */
function makeSlowPanel(list) {
  return defineCollectionPanel({
    id: "TIMING",
    icon: "🧪",
    titleKey: "panels.feeds.title",
    descriptionKey: "panels.feeds.description",
    emptyKey: "panels.feeds.empty",
    hintKey: "panels.feeds.hint",
    fields: [{ id: "name", nameKey: "panels.counters.fields.name", emoji: "✏️", type: "text", required: true }],
    list,
    keyOf: (entry) => entry.id,
    summarise: (entry) => entry.id,
    describe: (entry) => entry.id,
    toValues: (entry) => ({ name: entry.id }),
    create: async () => ({ ok: true, message: "ok" }),
    update: async () => ({ ok: true, message: "ok" }),
    remove: async () => ({ ok: true, message: "ok" }),
  });
}

test.beforeEach(() => draft.reset());

/* ------------------------------------------------------------- the mechanism */

test("acknowledging is skipped once the click has been answered", async () => {
  const answered = makeInteraction();
  await answered.update({});
  await ack(answered);

  assert.equal(answered.seen.defer, 0, "an answered click is not deferred on top");
});

test("something slow acknowledges the click while it is still running", async () => {
  const interaction = makeInteraction();
  const work = deferred();

  const waiting = ackIfSlow(interaction, work.promise, 20);
  await new Promise((resolve) => setTimeout(resolve, 60));

  assert.equal(interaction.seen.defer, 1, "the click is acknowledged before the work finishes");

  work.release("settings");
  assert.equal(await waiting, "settings", "and the caller still gets what it asked for");
});

test("something quick is not acknowledged at all", async () => {
  const interaction = makeInteraction();

  assert.equal(await ackIfSlow(interaction, Promise.resolve("settings"), 1000), "settings");
  assert.equal(interaction.seen.defer, 0, "a cache hit costs no extra round-trip");
});

test("a panel draws by editing once the click was acknowledged", async () => {
  const interaction = makeInteraction();
  await ack(interaction);
  await redraw(interaction, { embeds: [] });

  assert.equal(interaction.seen.drawn[0].how, "edit");
});

test("a refusal after an acknowledgement arrives as a follow-up", async () => {
  const interaction = makeInteraction();

  await warn(interaction, "первое");
  await warn(interaction, "второе");

  assert.deepEqual(interaction.seen.reply[0].content, "первое");
  assert.deepEqual(interaction.seen.followUp[0].content, "второе", "a second reply would be refused by Discord");
});

test("an expired click is recognised as such", () => {
  assert.equal(expired({ code: 10062 }), true, "unknown interaction");
  assert.equal(expired({ code: 40060 }), true, "already acknowledged");
  assert.equal(expired({ code: 50013 }), false, "missing permissions is a real problem");
});

/* ----------------------------------------------------------------- the paths */

test("opening a list acknowledges the click before reading the collection", async () => {
  const reading = deferred();
  const panel = makeSlowPanel(() => reading.promise);
  const interaction = makeInteraction({ customId: "TIMING:list" });

  const handled = panel.handle(interaction, {}, t);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(interaction.seen.defer, 1, "the click is answered before the database is");
  assert.equal(interaction.seen.drawn.length, 0, "and nothing is drawn until there is something to draw");

  reading.release([{ id: "a" }]);
  await handled;

  assert.equal(interaction.seen.drawn[0].how, "edit");
});

test("opening one entry acknowledges the click before looking it up", async () => {
  const reading = deferred();
  const panel = makeSlowPanel(() => reading.promise);
  const interaction = makeInteraction({ customId: "TIMING:open:a" });

  const handled = panel.handle(interaction, {}, t);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(interaction.seen.defer, 1);

  reading.release([{ id: "a" }]);
  await handled;

  assert.match(interaction.seen.drawn[0].payload.embeds[0].data.description, /`a`/);
});

test("the hub acknowledges the click before counting what each system holds", async () => {
  const counting = deferred();
  const settings = { counters: [], save: async () => {} };
  const interaction = makeInteraction({ customId: "PANELHUB:home" });

  // The list systems answer from the database; here one of them never does.
  const { PANELS } = require("@src/services/panels/registry");
  const original = PANELS.feeds.isActive;
  PANELS.feeds.isActive = () => counting.promise;

  try {
    const handled = handle.call({ matches, handle }, interaction, settings);
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(interaction.seen.defer, 1, "the hub does not wait on the database to answer the click");

    counting.release(false);
    await handled;

    assert.match(interaction.seen.drawn[0].payload.embeds[0].data.title, /Панель управления/);
  } finally {
    PANELS.feeds.isActive = original;
  }
});

test("the hub gives up on a system that will not answer, and still opens", async () => {
  const settings = { counters: [], save: async () => {} };
  const { PANELS } = require("@src/services/panels/registry");
  const original = PANELS.feeds.isActive;
  // A database that never answers at all.
  PANELS.feeds.isActive = () => new Promise(() => {});

  try {
    const hub = await buildHub(t, settings, {}, { id: "9" });
    const [running, idle] = hub.embeds[0].data.fields;

    assert.match(`${running.value}\n${idle.value}`, /Ленты/, "the system is still listed");
    assert.match(idle.value, /Ленты/, "and counted as off rather than holding the panel up");
  } finally {
    PANELS.feeds.isActive = original;
  }
});
