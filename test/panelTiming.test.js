const test = require("node:test");
const assert = require("node:assert/strict");
require("module-alias/register");

const { PATIENCE_MS, ack, ackIfSlow, expired, redraw, warn } = require("@src/services/panels/reply");
const { defineCollectionPanel } = require("@src/services/panels/collectionPanel");
const controlPanel = require("@src/handlers/controlPanel");
const { COLLECTION_IDS } = require("@src/services/panels/registry");
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

test("a list that reads quickly is drawn in one go, with its buttons live", async () => {
  const panel = makeSlowPanel(async () => [{ id: "a" }]);
  const interaction = makeInteraction({ customId: "TIMING:list" });

  await panel.handle(interaction, {}, t);

  assert.equal(interaction.seen.defer, 0, "a warm read costs no acknowledgement, so nothing is greyed out");
  assert.equal(interaction.seen.drawn[0].how, "update");
});

test("a list that keeps the click waiting acknowledges it, then edits", async () => {
  const reading = deferred();
  const panel = makeSlowPanel(() => reading.promise);
  const interaction = makeInteraction({ customId: "TIMING:list" });

  const handled = panel.handle(interaction, {}, t);
  await new Promise((resolve) => setTimeout(resolve, PATIENCE_MS + 100));

  assert.equal(interaction.seen.defer, 1, "the click is answered before Discord gives up on it");
  assert.equal(interaction.seen.drawn.length, 0, "and nothing is drawn until there is something to draw");

  reading.release([{ id: "a" }]);
  await handled;

  assert.equal(interaction.seen.drawn[0].how, "edit");
});

test("opening one entry waits on the lookup only as long as it is safe to", async () => {
  const reading = deferred();
  const panel = makeSlowPanel(() => reading.promise);
  const interaction = makeInteraction({ customId: "TIMING:open:a" });

  const handled = panel.handle(interaction, {}, t);
  await new Promise((resolve) => setTimeout(resolve, PATIENCE_MS + 100));

  assert.equal(interaction.seen.defer, 1);

  reading.release([{ id: "a" }]);
  await handled;

  assert.match(interaction.seen.drawn[0].payload.embeds[0].data.description, /`a`/);
});

test("the hub opens at once when every system answers from memory", async () => {
  const settings = { counters: [], save: async () => {} };
  const interaction = makeInteraction({ customId: "PANELHUB:home" });

  const { PANELS } = require("@src/services/panels/registry");
  const originals = COLLECTION_IDS.map((name) => [name, PANELS[name].isActive]);
  for (const [name] of originals) PANELS[name].isActive = () => false;

  try {
    await controlPanel.handle(interaction, settings);

    assert.equal(interaction.seen.defer, 0, "nothing was slow, so nothing was acknowledged");
    assert.match(interaction.seen.drawn[0].payload.embeds[0].data.title, /Панель управления/);
  } finally {
    for (const [name, isActive] of originals) PANELS[name].isActive = isActive;
  }
});

test("the hub acknowledges the click when counting what a system holds drags", async () => {
  const counting = deferred();
  const settings = { counters: [], save: async () => {} };
  const interaction = makeInteraction({ customId: "PANELHUB:home" });

  // The list systems answer from the database; here one of them never does.
  const { PANELS } = require("@src/services/panels/registry");
  const original = PANELS.feeds.isActive;
  PANELS.feeds.isActive = () => counting.promise;

  try {
    const handled = controlPanel.handle(interaction, settings);
    await new Promise((resolve) => setTimeout(resolve, PATIENCE_MS + 100));

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
    const hub = await controlPanel.buildHub(t, settings, {}, { id: "9" });
    const [running, idle] = hub.embeds[0].data.fields;

    assert.match(`${running.value}\n${idle.value}`, /Ленты/, "the system is still listed");
    assert.match(idle.value, /Ленты/, "and counted as off rather than holding the panel up");
  } finally {
    PANELS.feeds.isActive = original;
  }
});

/* ------------------------------------------------------------- broken input */

test("a panel that throws says so instead of leaving the click unanswered", async () => {
  const panel = makeSlowPanel(() => {
    throw new TypeError("stored data from an older shape");
  });

  const interaction = makeInteraction({ customId: "TIMING:list" });
  const settings = { counters: [], save: async () => {} };
  const logged = [];

  const { guard } = require("@src/services/panels/reply");
  await guard(interaction, () => panel.handle(interaction, settings, t), {
    message: "не получилось",
    logger: { error: (...args) => logged.push(args) },
  });

  assert.equal(interaction.seen.reply[0]?.content || interaction.seen.followUp[0]?.content, "не получилось");
  assert.equal(logged.length, 1, "and the reason is in the log rather than lost");
});

test("one unreadable entry costs its own line, not the list", async () => {
  const panel = makeSlowPanel(async () => [{ id: "a" }, { id: null }]);
  const interaction = makeInteraction({ customId: "TIMING:list" });

  // The second entry has no id, so describing it the usual way throws.
  const broken = defineCollectionPanel({
    id: "BROKEN",
    icon: "🧪",
    titleKey: "panels.feeds.title",
    descriptionKey: "panels.feeds.description",
    emptyKey: "panels.feeds.empty",
    hintKey: "panels.feeds.hint",
    fields: [{ id: "name", nameKey: "panels.counters.fields.name", emoji: "✏️", type: "text", required: true }],
    list: async () => [{ id: "a" }, { id: null }],
    keyOf: (entry) => entry.id || "?",
    summarise: (entry) => entry.id.toUpperCase(),
    describe: (entry) => entry.id.toUpperCase(),
    toValues: (entry) => ({ name: entry.id }),
    create: async () => ({ ok: true, message: "ok" }),
    update: async () => ({ ok: true, message: "ok" }),
    remove: async () => ({ ok: true, message: "ok" }),
  });

  const click = makeInteraction({ customId: "BROKEN:list" });
  await broken.handle(click, {}, t);

  const description = click.seen.drawn[0].payload.embeds[0].data.description;
  assert.match(description, /A/, "the entry that reads fine is still shown");
  assert.match(description, /⚠️/, "and the one that does not is flagged");

  assert.ok(panel && interaction, "the slow panel above is untouched by this");
});

test("a counter stored without its kind does not break the list", async () => {
  const { PANELS } = require("@src/services/panels/registry");
  const settings = { counters: [{ name: "Сломанный", channel_id: "555" }], save: async () => {} };
  const interaction = makeInteraction({ customId: "PANELHUB:open:counters" });

  await controlPanel.handle(interaction, settings);

  assert.equal(interaction.seen.drawn.length, 1, "the panel still opens");
  assert.ok(PANELS.counters.fields.length);
});

test("a category with nothing left in it opens without an empty menu", async () => {
  const commandPanel = require("@src/handlers/commandPanel");
  const interaction = makeInteraction({ customId: "CMDP:cat:MUSIC" });
  // Nobody may run anything here any more.
  interaction.client.slashCommands = new Map();
  interaction.client.commands = [];
  interaction.member.id = "1";

  await commandPanel.handle(interaction, {});

  const menus = interaction.seen.drawn[0].payload.components.flatMap((row) =>
    row.components.filter((component) => component.options)
  );
  assert.equal(menus.length, 0, "Discord refuses a select menu with no rows");
});

test("no screen of the command panel carries one custom id twice", async () => {
  const commandPanel = require("@src/handlers/commandPanel");

  // Discord refuses the whole message over a repeated custom id, so a screen one
  // step from the catalogue must not offer "back" and "home" as the same button.
  for (const customId of ["CMDP:home", "CMDP:cat:ADMIN", "CMDP:cat:MUSIC", "CMDP:cat:UTILITY"]) {
    const interaction = makeInteraction({ customId });
    await commandPanel.handle(interaction, {});

    const ids = interaction.seen.drawn[0].payload.components
      .flatMap((row) => row.components)
      .map((component) => component.data?.custom_id)
      .filter(Boolean);

    assert.equal(new Set(ids).size, ids.length, `${customId} draws a duplicated custom id: ${ids.join(", ")}`);
  }
});

test("two counters of the same kind do not take the panel down with them", async () => {
  // Servers set up before the panel can hold a pair the kind cannot tell apart,
  // and Discord refuses a menu that offers one value twice.
  const settings = {
    counters: [
      { counter_type: "MEMBERS", channel_id: "111", name: "Участники" },
      { counter_type: "members", channel_id: "222", name: "Ещё участники" },
    ],
    save: async () => {},
  };
  const interaction = makeInteraction({ customId: "PANELHUB:open:counters" });

  await controlPanel.handle(interaction, settings);

  const [menu] = interaction.seen.drawn[0].payload.components
    .flatMap((row) => row.components)
    .filter((component) => component.options);

  const values = menu.options.map((option) => option.value ?? option.data?.value);
  assert.equal(new Set(values).size, values.length, `the menu offers a value twice: ${values.join(", ")}`);
  assert.deepEqual(values, ["111", "222"], "each counter is opened by its own channel");
});
