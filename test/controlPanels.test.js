const test = require("node:test");
const assert = require("node:assert/strict");
require("module-alias/register");

const { buildHub, handle, matches } = require("@src/handlers/controlPanel");
const { HOME_ID, PANELS, SYSTEM_ICONS, SYSTEM_IDS } = require("@src/services/panels/registry");
const { LOCALES, translate } = require("@src/i18n");

const t = (key, vars) => translate("ru", key, vars);

/**
 * Guild settings stand-in: plain data plus the save() the panels call.
 */
function makeSettings(overrides = {}) {
  const settings = {
    saves: 0,
    prefix: "!",
    stats: { enabled: false },
    invite: { tracking: false },
    max_warn: { limit: 5, action: "KICK" },
    ticket: { log_channel: null, limit: 10, staff_roles: [] },
    automod: { strikes: 10, action: "TIMEOUT", anti_spam: false, max_lines: 0 },
    welcome: { enabled: false, channel: null, embed: { description: "", color: null } },
    ...overrides,
  };

  settings.save = async () => {
    settings.saves += 1;
  };

  return settings;
}

/**
 * @param {{customId: string, values?: string[], text?: string, manageGuild?: boolean}} input
 */
function makeInteraction({ customId, values, text, manageGuild = true }) {
  const seen = { update: [], reply: [], modal: [] };

  return {
    customId,
    values,
    seen,
    client: {},
    guild: { preferredLocale: "ru" },
    member: { permissions: { has: () => manageGuild } },
    fields: { getTextInputValue: () => text },
    isFromMessage: () => true,
    update: async (payload) => seen.update.push(payload),
    reply: async (payload) => seen.reply.push(payload),
    showModal: async (modal) => seen.modal.push(modal),
  };
}

const router = { matches, handle };
const route = (interaction, settings) => router.handle.call(router, interaction, settings);

/* --------------------------------------------------------------- structure */

test("every system fits inside Discord's component limits", () => {
  const settings = makeSettings();

  for (const name of SYSTEM_IDS) {
    const panel = PANELS[name].build(t, settings);

    assert.ok(panel.components.length <= 5, `${name} has ${panel.components.length} rows`);
    for (const row of panel.components) {
      assert.ok(row.components.length <= 5, `${name} has a row of ${row.components.length}`);
    }
  }
});

test("the hub offers every system and an icon for it", () => {
  const hub = buildHub(t, makeSettings());
  const buttons = hub.components.flatMap((row) => row.components.map((button) => button.data));

  assert.equal(buttons.length, SYSTEM_IDS.length);
  for (const name of SYSTEM_IDS) {
    assert.ok(SYSTEM_ICONS[name], `${name} has no icon`);
    assert.ok(
      buttons.some((button) => button.custom_id === `PANELHUB:open:${name}`),
      `${name} has no button`
    );
  }
});

test("panels do not answer for each other", () => {
  for (const name of SYSTEM_IDS) {
    const own = PANELS[name].panel.buttonId("whatever");

    for (const other of SYSTEM_IDS) {
      if (other === name) continue;
      assert.equal(PANELS[other].matches(own), false, `${other} claims ${name}'s ids`);
    }
  }
});

test("every field is named in every language", () => {
  for (const locale of Object.keys(LOCALES)) {
    for (const name of SYSTEM_IDS) {
      for (const field of PANELS[name].fields) {
        const key = `panels.${name}.fields.${field.id}`;
        assert.notEqual(translate(locale, key), key, `${locale} is missing ${key}`);
      }
    }
  }
});

test("choice fields translate each of their values", () => {
  for (const locale of Object.keys(LOCALES)) {
    for (const name of SYSTEM_IDS) {
      for (const field of PANELS[name].fields.filter((entry) => entry.type === "choice")) {
        for (const choice of field.choices) {
          const key = `${field.choicesKey}.${choice}`;
          assert.notEqual(translate(locale, key), key, `${locale} is missing ${key}`);
        }
      }
    }
  }
});

test("the panel shows what each setting currently is", () => {
  const settings = makeSettings({ ticket: { log_channel: "555", limit: 3, staff_roles: ["777"] } });
  const description = PANELS.ticket.build(t, settings).embeds[0].data.description;

  assert.match(description, /<#555>/);
  assert.match(description, /`3`/);
  assert.match(description, /<@&777>/);
});

/* ----------------------------------------------------------------- routing */

test("the router recognises the hub and its systems, and nothing else", () => {
  assert.equal(matches(HOME_ID), true);
  assert.equal(matches("PANELHUB:open:ticket"), true);
  assert.equal(matches(PANELS.automod.panel.buttonId("spam")), true);
  assert.equal(matches("TICKET_CREATE"), false);
  assert.equal(matches("TV:name"), false);
});

test("a button opens that system's panel in place", async () => {
  const interaction = makeInteraction({ customId: "PANELHUB:open:ticket" });
  await route(interaction, makeSettings());

  assert.equal(interaction.seen.update.length, 1);
  assert.equal(interaction.seen.update[0].embeds[0].data.title, t("panels.ticket.title"));
});

test("the menu button goes back to the hub", async () => {
  const interaction = makeInteraction({ customId: HOME_ID });
  await route(interaction, makeSettings());

  assert.equal(interaction.seen.update[0].embeds[0].data.title, t("panels.hub.title"));
});

test("settings stay behind Manage Server", async () => {
  const settings = makeSettings();
  const interaction = makeInteraction({ customId: PANELS.automod.panel.buttonId("spam"), manageGuild: false });

  await route(interaction, settings);

  assert.equal(settings.saves, 0);
  assert.equal(interaction.seen.update.length, 0);
  assert.equal(interaction.seen.reply[0].content, t("panels.common.forbidden"));
});

test("a toggle flips the setting and redraws", async () => {
  const settings = makeSettings();
  const interaction = makeInteraction({ customId: PANELS.automod.panel.buttonId("spam") });

  await route(interaction, settings);

  assert.equal(settings.automod.anti_spam, true);
  assert.equal(settings.saves, 1);
  assert.equal(interaction.seen.update.length, 1);
});

test("the panel redraws without waiting for the database write", async () => {
  const settings = makeSettings();
  let finishWrite;
  settings.save = () => new Promise((resolve) => (finishWrite = resolve));

  const interaction = makeInteraction({ customId: PANELS.automod.panel.buttonId("spam") });
  const handled = route(interaction, settings);

  // Let the pending microtasks run while the write is still outstanding.
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(interaction.seen.update.length, 1, "the click is answered before the write lands");

  finishWrite();
  await handled;
});

test("a picker replaces the buttons instead of sending a new message", async () => {
  const interaction = makeInteraction({ customId: PANELS.ticket.panel.buttonId("staff") });
  await route(interaction, makeSettings());

  const [payload] = interaction.seen.update;
  assert.equal(payload.components[0].components[0].data.custom_id, PANELS.ticket.panel.selectId("staff"));
  assert.equal(interaction.seen.reply.length, 0);
});

test("picking a channel stores one id, picking roles stores the list", async () => {
  const settings = makeSettings();

  await route(makeInteraction({ customId: PANELS.ticket.panel.selectId("log"), values: ["999"] }), settings);
  assert.equal(settings.ticket.log_channel, "999");

  await route(makeInteraction({ customId: PANELS.ticket.panel.selectId("staff"), values: ["1", "2"] }), settings);
  assert.deepEqual(settings.ticket.staff_roles, ["1", "2"]);

  // Clearing a list is picking nothing.
  await route(makeInteraction({ customId: PANELS.ticket.panel.selectId("staff"), values: [] }), settings);
  assert.deepEqual(settings.ticket.staff_roles, []);
});

test("a text button opens a modal carrying the current value", async () => {
  const settings = makeSettings({ prefix: "?" });
  const interaction = makeInteraction({ customId: PANELS.server.panel.buttonId("prefix") });

  await route(interaction, settings);

  const modal = interaction.seen.modal[0].toJSON();
  assert.equal(modal.custom_id, PANELS.server.panel.modalId("prefix"));
  assert.equal(modal.components[0].components[0].value, "?", "the modal opens on the value being replaced");
});

test("a submitted number is bounded before it is stored", async () => {
  const settings = makeSettings();

  const tooBig = makeInteraction({ customId: PANELS.ticket.panel.modalId("limit"), text: "500" });
  await route(tooBig, settings);
  assert.equal(settings.ticket.limit, 10, "the old value survives");
  assert.equal(settings.saves, 0);
  assert.match(tooBig.seen.reply[0].content, /1.*100/);

  const fine = makeInteraction({ customId: PANELS.ticket.panel.modalId("limit"), text: "25" });
  await route(fine, settings);
  assert.equal(settings.ticket.limit, 25);
  assert.equal(fine.seen.update.length, 1, "the panel redraws with the new value");
});

test("submitted text is stored, and clearing it empties the setting", async () => {
  const settings = makeSettings();

  await route(makeInteraction({ customId: PANELS.welcome.panel.modalId("description"), text: "Привет!" }), settings);
  assert.equal(settings.welcome.embed.description, "Привет!");

  await route(makeInteraction({ customId: PANELS.welcome.panel.modalId("description"), text: "   " }), settings);
  assert.equal(settings.welcome.embed.description, null);
});

test("a choice is stored as its stable value, not its label", async () => {
  const settings = makeSettings();

  await route(makeInteraction({ customId: PANELS.server.panel.selectId("warnaction"), values: ["BAN"] }), settings);

  assert.equal(settings.max_warn.action, "BAN");
  assert.match(PANELS.server.build(t, settings).embeds[0].data.description, /бан/);
});
