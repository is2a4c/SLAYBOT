const test = require("node:test");
const assert = require("node:assert/strict");
require("module-alias/register");

const { ButtonStyle } = require("discord.js");
const { defineCollectionPanel } = require("@src/services/panels/collectionPanel");
const { COLLECTION_IDS, PANELS } = require("@src/services/panels/registry");
const draft = require("@src/services/panels/draft");
const { translate } = require("@src/i18n");

const t = (key, vars) => translate("ru", key, vars);
const USER = "100000000000000001";
const CHANNEL = "100000000000000005";

/**
 * A list panel over a plain array, so the engine can be driven without a database.
 */
function makePanel(overrides = {}) {
  const store = [{ id: "a", name: "первая", channel: CHANNEL, enabled: true }];
  const calls = { create: [], update: [], remove: [] };

  const panel = defineCollectionPanel({
    id: "TESTCOL",
    icon: "🧪",
    titleKey: "panels.feeds.title",
    descriptionKey: "panels.feeds.description",
    emptyKey: "panels.feeds.empty",
    hintKey: "panels.feeds.hint",
    homeId: "PANELHUB:home",
    max: 2,
    fields: [
      { id: "name", nameKey: "panels.counters.fields.name", emoji: "✏️", type: "text", required: true, maxLength: 50 },
      { id: "channel", nameKey: "panels.sticky.fields.channel", emoji: "📢", type: "channel", required: true },
      { id: "enabled", nameKey: "panels.sticky.fields.enabled", emoji: "🔘", type: "toggle", default: true },
    ],
    list: async () => store,
    keyOf: (entry) => entry.id,
    summarise: (entry) => entry.name,
    describe: (entry) => `🧪 ${entry.name} → <#${entry.channel}>`,
    toValues: (entry) => ({ name: entry.name, channel: entry.channel, enabled: entry.enabled }),
    create: async ({ values }) => {
      calls.create.push(values);
      store.push({ id: "b", ...values });
      return { ok: true, message: "создано" };
    },
    update: async ({ key, values }) => {
      calls.update.push({ key, values });
      return { ok: true, message: "сохранено" };
    },
    remove: async ({ key }) => {
      calls.remove.push(key);
      return { ok: true, message: "удалено" };
    },
    ...overrides,
  });

  return { panel, store, calls };
}

/**
 * @param {{customId: string, values?: string[], text?: string}} input
 */
function makeInteraction({ customId, values, text }) {
  const seen = { update: [], reply: [], modal: [], edit: [], followUp: [], defer: 0 };

  return {
    customId,
    values,
    seen,
    user: { id: USER },
    member: { permissions: { has: () => true } },
    client: { user: { username: "SLAYBOT" } },
    guild: {
      id: "900000000000000009",
      preferredLocale: "ru",
      channels: { cache: new Map([[CHANNEL, { id: CHANNEL }]]) },
      roles: { cache: new Map() },
    },
    fields: { getTextInputValue: () => text },
    update: async (payload) => seen.update.push(payload),
    reply: async (payload) => seen.reply.push(payload),
    showModal: async (modal) => seen.modal.push(modal),
    deferUpdate: async () => (seen.defer += 1),
    editReply: async (payload) => seen.edit.push(payload),
    followUp: async (payload) => seen.followUp.push(payload),
  };
}

test.beforeEach(() => draft.reset());

/* ------------------------------------------------------------------- engine */

test("the list names what the server has and offers to add another", async () => {
  const { panel } = makePanel();
  const interaction = makeInteraction({ customId: "TESTCOL:list" });

  await panel.handle(interaction, {}, t);

  const [payload] = interaction.seen.update;
  assert.match(payload.embeds[0].data.description, /первая/);

  const menu = payload.components[0].components[0].toJSON();
  assert.deepEqual(
    menu.options.map((option) => option.value),
    ["a"]
  );

  const add = payload.components[1].components[0].data;
  assert.equal(add.custom_id, "TESTCOL:new");
  assert.equal(add.disabled, false);
});

test("a full list cannot be added to", async () => {
  const { panel, store } = makePanel();
  store.push({ id: "b", name: "вторая", channel: CHANNEL, enabled: true });

  const interaction = makeInteraction({ customId: "TESTCOL:list" });
  await panel.handle(interaction, {}, t);

  const add = interaction.seen.update[0].components[1].components[0].data;
  assert.equal(add.disabled, true, "the limit is shown, not discovered on save");
});

test("opening an entry fills the form with what is stored", async () => {
  const { panel } = makePanel();
  const interaction = makeInteraction({ customId: "TESTCOL~SEL:open:", values: ["a"] });

  await panel.handle(interaction, {}, t);

  const description = interaction.seen.update[0].embeds[0].data.description;
  assert.match(description, /`первая`/);
  assert.match(description, new RegExp(`<#${CHANNEL}>`));
  assert.deepEqual(draft.read(USER, "TESTCOL|a").name, "первая");
});

test("a new entry starts empty, with its defaults, and cannot be created yet", async () => {
  const { panel } = makePanel();
  const interaction = makeInteraction({ customId: "TESTCOL:new" });

  await panel.handle(interaction, {}, t);

  const [payload] = interaction.seen.update;
  assert.match(payload.embeds[0].data.description, /⚠️/, "what is missing is flagged");
  assert.equal(draft.read(USER, "TESTCOL|+").enabled, true, "a default is filled in for you");

  const create = payload.components
    .flatMap((row) => row.components)
    .find((button) => button.data.custom_id === "TESTCOL:save:+");
  assert.equal(create.data.disabled, true);
});

test("filling the fields unlocks creating, and creating stores what was filled in", async () => {
  const { panel, calls } = makePanel();

  await panel.handle(makeInteraction({ customId: "TESTCOL:new" }), {}, t);
  await panel.handle(makeInteraction({ customId: "TESTCOL~MOD:field:+|name", text: "вторая" }), {}, t);
  await panel.handle(makeInteraction({ customId: "TESTCOL~SEL:field:+|channel", values: [CHANNEL] }), {}, t);

  const run = makeInteraction({ customId: "TESTCOL:save:+" });
  await panel.handle(run, {}, t);

  assert.deepEqual(calls.create, [{ enabled: true, name: "вторая", channel: CHANNEL }]);
  assert.equal(run.seen.defer, 1, "saving talks to Discord, so the click is acknowledged first");
  assert.deepEqual(run.seen.followUp[0].content, "создано");
  assert.match(run.seen.edit[0].embeds[0].data.description, /вторая/, "the list comes back with it");
  assert.deepEqual(draft.read(USER, "TESTCOL|+"), {}, "the draft does not linger into the next entry");
});

test("a half-filled entry is refused instead of half-created", async () => {
  const { panel, calls } = makePanel();

  await panel.handle(makeInteraction({ customId: "TESTCOL:new" }), {}, t);
  const run = makeInteraction({ customId: "TESTCOL:save:+" });
  await panel.handle(run, {}, t);

  assert.deepEqual(calls.create, []);
  assert.match(run.seen.reply[0].content, /Сначала заполни/);
});

test("editing an entry saves it under its own key", async () => {
  const { panel, calls } = makePanel();

  await panel.handle(makeInteraction({ customId: "TESTCOL:open:a" }), {}, t);
  await panel.handle(makeInteraction({ customId: "TESTCOL~MOD:field:a|name", text: "переименована" }), {}, t);
  await panel.handle(makeInteraction({ customId: "TESTCOL:save:a" }), {}, t);

  assert.equal(calls.update.length, 1);
  assert.equal(calls.update[0].key, "a");
  assert.equal(calls.update[0].values.name, "переименована");
});

test("a toggle flips in place and colours its button", async () => {
  const { panel } = makePanel();

  await panel.handle(makeInteraction({ customId: "TESTCOL:open:a" }), {}, t);
  const flip = makeInteraction({ customId: "TESTCOL:field:a|enabled" });
  await panel.handle(flip, {}, t);

  assert.equal(draft.read(USER, "TESTCOL|a").enabled, false);

  const button = flip.seen.update[0].components
    .flatMap((row) => row.components)
    .find((entry) => entry.data.custom_id === "TESTCOL:field:a|enabled");
  assert.equal(button.data.style, ButtonStyle.Secondary);
});

test("deleting an entry asks the panel to remove it and returns to the list", async () => {
  const { panel, calls } = makePanel();
  const interaction = makeInteraction({ customId: "TESTCOL:del:a" });

  await panel.handle(interaction, {}, t);

  assert.deepEqual(calls.remove, ["a"]);
  assert.equal(interaction.seen.followUp[0].content, "удалено");
});

test("an entry that vanished sends you back to the list rather than to an empty form", async () => {
  const { panel } = makePanel();
  const interaction = makeInteraction({ customId: "TESTCOL:open:gone" });

  await panel.handle(interaction, {}, t);

  assert.match(interaction.seen.update[0].embeds[0].data.title, /Ленты/);
});

test("a number outside its range is refused without touching the draft", async () => {
  const { panel } = makePanel({
    fields: [{ id: "count", nameKey: "panels.sticky.fields.minMessages", emoji: "🔢", type: "number", min: 1, max: 5 }],
  });

  const interaction = makeInteraction({ customId: "TESTCOL~MOD:field:a|count", text: "99" });
  await panel.handle(interaction, {}, t);

  assert.equal(draft.read(USER, "TESTCOL|a").count, undefined);
  assert.match(interaction.seen.reply[0].content, /1.*5/);
});

test("the panel does not answer for ids that are not its own", () => {
  const { panel } = makePanel();

  assert.equal(panel.matches("TESTCOL:list"), true);
  assert.equal(panel.matches("TESTCOL~SEL:open:"), true);
  assert.equal(panel.matches("CFG_FEEDS:list"), false);
  assert.equal(panel.matches("PANELHUB:home"), false);
});

/* --------------------------------------------------------- the real panels */

test("every list panel is wired into the hub and names its fields in both languages", () => {
  assert.deepEqual(COLLECTION_IDS, ["feeds", "counters", "sticky", "reactionroles"]);

  for (const name of COLLECTION_IDS) {
    const panel = PANELS[name];
    assert.equal(typeof panel.open, "function", `${name} cannot be opened from the hub`);
    assert.ok(panel.fields.length, `${name} has no fields`);

    for (const locale of ["ru", "en"]) {
      for (const key of [`panels.${name}.title`, `panels.${name}.description`, `panels.${name}.empty`]) {
        assert.notEqual(translate(locale, key), key, `${locale} is missing ${key}`);
      }

      for (const field of panel.fields) {
        assert.notEqual(translate(locale, field.nameKey), field.nameKey, `${locale} is missing ${field.nameKey}`);
      }
    }
  }
});

test("each list panel keeps a required key that identifies an entry", () => {
  for (const name of COLLECTION_IDS) {
    const required = PANELS[name].fields.filter((field) => field.required);
    assert.ok(required.length, `${name} would let an empty entry be created`);
  }
});
