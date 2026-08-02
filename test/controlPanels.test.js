const test = require("node:test");
const assert = require("node:assert/strict");
require("module-alias/register");

const { ButtonStyle } = require("discord.js");
const { buildHub, handle, matches } = require("@src/handlers/controlPanel");
const { HOME_ID, PANELS, SETTINGS_IDS, SYSTEM_ICONS, SYSTEM_IDS } = require("@src/services/panels/registry");
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
  const seen = { update: [], reply: [], modal: [], defer: 0 };

  const interaction = {
    customId,
    values,
    seen,
    deferred: false,
    replied: false,
    client: {},
    user: { id: "1" },
    guild: { preferredLocale: "ru" },
    member: { permissions: { has: () => manageGuild } },
    fields: { getTextInputValue: () => text },
    isFromMessage: () => true,
    // Both ways of drawing land in the same place: what matters is what the
    // message ended up showing.
    update: async (payload) => {
      interaction.replied = true;
      seen.update.push(payload);
    },
    editReply: async (payload) => seen.update.push(payload),
    deferUpdate: async () => {
      interaction.deferred = true;
      seen.defer += 1;
    },
    reply: async (payload) => {
      interaction.replied = true;
      seen.reply.push(payload);
    },
    followUp: async (payload) => seen.reply.push(payload),
    showModal: async (modal) => seen.modal.push(modal),
  };

  return interaction;
}

const router = { matches, handle };
const route = (interaction, settings) => router.handle.call(router, interaction, settings);

/* --------------------------------------------------------------- structure */

test("every system fits inside Discord's component limits", () => {
  const settings = makeSettings();

  for (const name of SETTINGS_IDS) {
    const panel = PANELS[name].build(t, settings);

    assert.ok(panel.components.length <= 5, `${name} has ${panel.components.length} rows`);
    for (const row of panel.components) {
      assert.ok(row.components.length <= 5, `${name} has a row of ${row.components.length}`);
    }
  }
});

test("the hub offers every system and an icon for it", async () => {
  const hub = await buildHub(t, makeSettings());
  const buttons = hub.components.flatMap((row) => row.components.map((button) => button.data));

  // Every system, plus the way into the commands that are not settings.
  assert.equal(buttons.length, SYSTEM_IDS.length + 1);
  for (const name of SYSTEM_IDS) {
    assert.ok(SYSTEM_ICONS[name], `${name} has no icon`);
    assert.ok(
      buttons.some((button) => button.custom_id === `PANELHUB:open:${name}`),
      `${name} has no button`
    );
  }

  assert.ok(
    buttons.some((button) => button.custom_id === "CMDP:home"),
    "the hub does not lead to the commands"
  );
});

test("panels do not answer for each other", () => {
  for (const name of SYSTEM_IDS) {
    // A collection panel namespaces its ids the same way, without a button helper.
    const own = PANELS[name].panel ? PANELS[name].panel.buttonId("whatever") : `${PANELS[name].id}:whatever`;

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
        const key = field.nameKey || `panels.${name}.fields.${field.id}`;
        assert.notEqual(translate(locale, key), key, `${locale} is missing ${key}`);
      }
    }
  }
});

test("choice fields translate each of their values", () => {
  for (const locale of Object.keys(LOCALES)) {
    for (const name of SYSTEM_IDS) {
      for (const field of PANELS[name].fields.filter((entry) => entry.type === "choice")) {
        // A collection field carries its own labels rather than translation keys.
        if (!field.choicesKey) {
          for (const choice of field.choices) assert.ok(field.choiceLabels?.[choice], `${name}.${field.id} unlabelled`);
          continue;
        }

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

/* --------------------------------------------------------------- appearance */

test("a setting is named beside the icon of the button that changes it", () => {
  const settings = makeSettings({ ticket: { log_channel: "555", limit: 3, staff_roles: [] } });
  const description = PANELS.ticket.build(t, settings).embeds[0].data.description;

  const log = PANELS.ticket.fields.find((field) => field.id === "log");
  assert.match(description, new RegExp(`${log.emoji} \\*\\*${t("panels.ticket.fields.log")}:\\*\\* <#555>`));

  // Every field is on the panel exactly once: the icons are the legend.
  for (const field of PANELS.ticket.fields) {
    const name = t(`panels.ticket.fields.${field.id}`);
    assert.equal(description.split(`**${name}:**`).length, 2, `${field.id} is not shown once`);
  }
});

test("buttons carry the state of their setting", () => {
  const settings = makeSettings({
    ticket: { log_channel: "555", limit: 3, staff_roles: [] },
    automod: { anti_spam: true, anti_links: false, strikes: 10, action: "TIMEOUT" },
  });

  const styleOf = (panel, id) => {
    const button = panel
      .build(t, settings)
      .components.flatMap((row) => row.components)
      .find((entry) => entry.data.custom_id === panel.panel.buttonId(id));
    return button.data.style;
  };

  assert.equal(styleOf(PANELS.automod, "spam"), ButtonStyle.Success, "a setting that is on shows as on");
  assert.equal(styleOf(PANELS.automod, "links"), ButtonStyle.Secondary, "a setting that is off stays quiet");
  assert.equal(styleOf(PANELS.ticket, "log"), ButtonStyle.Primary, "a chosen channel is marked as chosen");
  assert.equal(styleOf(PANELS.ticket, "staff"), ButtonStyle.Secondary, "an empty list is not");
  assert.equal(styleOf(PANELS.ticket, "panel"), ButtonStyle.Success, "posting the panel is the call to action");
});

test("an unset setting says so rather than being left blank", () => {
  const description = PANELS.ticket.build(t, makeSettings()).embeds[0].data.description;

  assert.match(description, new RegExp(`\\*\\*${t("panels.ticket.fields.log")}:\\*\\* ⚪ ${t("common.notSet")}`));
  assert.match(description, new RegExp(`\\*\\*${t("panels.ticket.fields.staff")}:\\*\\* ⚪ ${t("common.none")}`));
});

test("a long setting is previewed instead of being poured into the panel", () => {
  const settings = makeSettings({
    ticket: { log_channel: null, limit: 3, staff_roles: [], panel_description: `${"а".repeat(900)}\n\`x\`` },
  });

  const description = PANELS.ticket.build(t, settings).embeds[0].data.description;

  assert.ok(description.length < 1000, `the panel grew to ${description.length} characters`);
  assert.match(description, /…`/, "the value is cut short");
  // A backtick inside the value would end the code span and style the rest of the panel.
  assert.equal((description.match(/`/g) || []).length % 2, 0, "the code spans are unbalanced");
});

test("the hub separates what the server is running from what it is not", async () => {
  const settings = makeSettings({
    starboard: { enabled: true },
    welcome: { enabled: false, channel: null, embed: {} },
  });

  const [running, idle] = (await buildHub(t, settings)).embeds[0].data.fields;
  assert.match(running.value, new RegExp(t("panels.starboard.title")));
  assert.match(idle.value, new RegExp(t("panels.welcome.title")));

  const hub = await buildHub(t, settings);
  const button = (name) =>
    hub.components.flatMap((row) => row.components).find((entry) => entry.data.custom_id === `PANELHUB:open:${name}`);

  assert.equal(button("starboard").data.style, ButtonStyle.Success);
  assert.equal(button("welcome").data.style, ButtonStyle.Secondary);
});

test("a system with nothing turned on still lists every other one", async () => {
  const [running, idle] = (await buildHub(t, makeSettings())).embeds[0].data.fields;
  const named = `${running.value}\n${idle.value}`;

  for (const name of SYSTEM_IDS) assert.match(named, new RegExp(t(`panels.${name}.title`)), `${name} is missing`);
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
  assert.equal(interaction.seen.update[0].embeds[0].data.title, `${SYSTEM_ICONS.ticket} ${t("panels.ticket.title")}`);
});

test("the menu button goes back to the hub", async () => {
  const interaction = makeInteraction({ customId: HOME_ID });
  await route(interaction, makeSettings());

  assert.match(interaction.seen.update[0].embeds[0].data.title, new RegExp(t("panels.hub.title")));
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

test("a picker opens on what is stored, and picking nothing clears it", async () => {
  const settings = makeSettings({ ticket: { log_channel: "555", limit: 3, staff_roles: [] } });
  const interaction = makeInteraction({ customId: PANELS.ticket.panel.buttonId("log") });
  interaction.guild.channels = { cache: new Map([["555", {}]]) };

  await route(interaction, settings);

  const menu = interaction.seen.update[0].components[0].components[0].data;
  assert.equal(menu.min_values, 0, "a channel can be unset again");
  assert.deepEqual(
    menu.default_values.map((value) => value.id),
    ["555"]
  );
});

test("a picker leaves out a channel the server no longer has", async () => {
  const settings = makeSettings({ ticket: { log_channel: "555", limit: 3, staff_roles: [] } });
  const interaction = makeInteraction({ customId: PANELS.ticket.panel.buttonId("log") });
  interaction.guild.channels = { cache: new Map() };

  await route(interaction, settings);

  // Discord rejects the whole menu if a default points at something gone.
  const menu = interaction.seen.update[0].components[0].components[0].data;
  assert.deepEqual(menu.default_values ?? [], []);
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

test("a number modal leaves room for every value it accepts", async () => {
  const settings = makeSettings({ birthdays: { utc_offset: 0 } });
  const interaction = makeInteraction({ customId: PANELS.birthdays.panel.buttonId("offset") });

  await route(interaction, settings);

  const [input] = interaction.seen.modal[0].toJSON().components[0].components;
  // The range is -12..14, so two characters would refuse the lowest offsets.
  assert.ok(input.max_length >= 3, `a UTC offset gets ${input.max_length} characters`);
  assert.match(input.placeholder, /-12/, "the modal says what it will accept");
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
