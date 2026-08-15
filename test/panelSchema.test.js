const test = require("node:test");
const assert = require("node:assert/strict");
require("module-alias/register");
require("@schemas/Guild");

const mongoose = require("mongoose");
const { EmbedBuilder } = require("discord.js");
const { PANELS, SETTINGS_IDS } = require("@src/services/panels/registry");
const { readPath, writePath } = require("@src/services/panels/configPanel");
const { CONTROL_MODULES } = require("../dashboard/services/controlCenter");

/**
 * The panels write straight into the guild document, so a field pointing at a
 * path that does not exist — or at one of a different shape — stores something
 * nothing ever reads back. That is exactly how autoroles were silently broken,
 * so it is checked here rather than discovered on a live server.
 */
const schema = mongoose.model("guild").schema;

// What each kind of panel field is allowed to sit on.
const ACCEPTS = {
  toggle: ["Boolean"],
  text: ["String"],
  number: ["Number"],
  channel: ["String"],
  role: ["String"],
  choice: ["String"],
  roleList: ["Array"],
  channelList: ["Array"],
  userList: ["Array"],
};

// A value of the shape the panel would store for each kind.
const SAMPLE = {
  toggle: true,
  text: "sample",
  number: 1,
  channel: "123456789012345678",
  role: "123456789012345678",
  choice: null, // filled in from the field's own choices
  roleList: ["123456789012345678"],
  channelList: ["123456789012345678"],
  userList: ["123456789012345678"],
};

// The list panels keep their entries in their own collections, so the guild
// document has nothing to check them against.
// A field that opens another panel stores nothing, so there is no setting behind
// it to check against the schema.
const everyField = () =>
  SETTINGS_IDS.flatMap((name) =>
    PANELS[name].fields
      .filter((field) => field.type !== "action")
      .map((field) => ({ name, field, path: PANELS[name].fieldPath(field) }))
  );

test("every panel field points at a setting the schema actually has", () => {
  for (const { name, field, path } of everyField()) {
    assert.ok(path, `${name}.${field.id} has no settings path`);
    assert.ok(schema.path(path), `${name}.${field.id} writes to "${path}", which the schema does not have`);
  }
});

test("every editable guild setting is reachable from the control panel", () => {
  const dashboardFields = CONTROL_MODULES.flatMap((module) =>
    module.groups.flatMap((group) => group.fields.map((field) => field.path))
  );
  const exposed = new Set([...everyField().map(({ path }) => path), ...dashboardFields]);
  const internal = new Set([
    "data.name",
    "data.region",
    "data.owner",
    "data.joinedAt",
    "data.leftAt",
    "data.bots",
    "data.inviteUrl",
    "ticket.panel_message_id",
    "temp_voice.panel_message_id",
    "verification.message_id",
  ]);
  // These are collection editors opened from their parent settings panel.
  const collections = new Set([
    "ticket.categories",
    "invite.ranks",
    "counters",
    "voice_roles.channels",
    "stats.rewards.level",
    "stats.rewards.voice",
    "automod.escalation_rules",
    "command_policy.disabled_categories",
    "command_policy.commands",
    "welcome.fields",
    "welcome.buttons",
    "farewell.fields",
    "farewell.buttons",
    "event_router",
  ]);

  for (const path of Object.keys(schema.paths)) {
    if (path === "_id" || path === "__v" || path.includes(".$*")) continue;
    assert.ok(
      exposed.has(path) || internal.has(path) || collections.has(path),
      `editable setting "${path}" is not reachable from a control panel`
    );
  }
});

test("every panel field matches the shape of the setting it writes", () => {
  for (const { name, field, path } of everyField()) {
    const declared = schema.path(path).instance || "Mixed";
    const accepted = ACCEPTS[field.type];

    assert.ok(accepted, `${name}.${field.id} uses an unknown field type "${field.type}"`);
    assert.ok(accepted.includes(declared), `${name}.${field.id} is a ${field.type} but "${path}" is ${declared}`);
  }
});

test("choice fields only offer values the schema allows", () => {
  for (const { name, field, path } of everyField()) {
    if (field.type !== "choice") continue;

    const allowed = schema.path(path).enumValues;
    if (!allowed?.length) continue;

    for (const choice of field.choices) {
      assert.ok(allowed.includes(choice), `${name}.${field.id} offers "${choice}", which "${path}" rejects`);
    }
  }
});

test("number fields stay inside the bounds the schema sets", () => {
  for (const { name, field, path } of everyField()) {
    if (field.type !== "number") continue;

    const declared = schema.path(path);
    const min = declared.options?.min;
    const max = declared.options?.max;

    if (min !== undefined)
      assert.ok(field.min >= min, `${name}.${field.id} allows ${field.min}, below the schema's ${min}`);
    if (max !== undefined)
      assert.ok(field.max <= max, `${name}.${field.id} allows ${field.max}, above the schema's ${max}`);
  }
});

test("text fields cannot store more than the schema keeps", () => {
  for (const { name, field, path } of everyField()) {
    if (field.type !== "text") continue;

    const limit = schema.path(path).options?.maxlength;
    if (limit === undefined) continue;

    assert.ok(
      (field.maxLength || 200) <= limit,
      `${name}.${field.id} accepts ${field.maxLength || 200} characters, but "${path}" keeps ${limit}`
    );
  }
});

test("what a panel writes survives a round-trip through the document", async () => {
  const Model = mongoose.model("guild");

  for (const { name, field, path } of everyField()) {
    // Numbers are checked at both ends of what the panel lets somebody enter.
    const values =
      field.type === "choice" ? field.choices : field.type === "number" ? [field.min, field.max] : [SAMPLE[field.type]];

    for (const value of values) {
      const document = new Model({ _id: "123456789012345678" });
      writePath(document, path, value);

      assert.deepEqual(
        JSON.parse(JSON.stringify(readPath(document, path))),
        value,
        `${name}.${field.id} did not survive being written to "${path}"`
      );

      await assert.doesNotReject(
        () => document.validate([path]),
        `${name}.${field.id} stores ${JSON.stringify(value)}, which "${path}" rejects`
      );
    }
  }
});

test("free text that Discord has to parse is validated before it is stored", () => {
  const validated = everyField().filter(({ field }) => field.validate);
  assert.ok(validated.length, "colours and image URLs are meant to be checked");

  for (const { name, field } of validated) {
    // A field says what a good answer looks like; the example is what it is for.
    const wantsUrl = String(field.example || "").startsWith("http");

    // Whatever a field accepts must survive being handed to a real embed.
    const good = field.validate(wantsUrl ? "https://example.com/a.png" : "a855f7");
    assert.equal(good.ok, true, `${name}.${field.id} rejected a valid value`);
    assert.doesNotThrow(() => {
      const embed = new EmbedBuilder();
      if (wantsUrl) embed.setImage(good.value);
      else embed.setColor(good.value);
    }, `${name}.${field.id} accepts something Discord refuses`);

    for (const bad of ["синий", "blue", "not-a-colour", "javascript:alert(1)", "http://example.com/a.png"]) {
      assert.equal(field.validate(bad).ok, false, `${name}.${field.id} accepted ${JSON.stringify(bad)}`);
    }
  }
});

test("a colour is accepted with or without its hash", () => {
  const { field } = everyField().find(({ field: entry }) => entry.id === "color");

  assert.equal(field.validate("a855f7").value, "#A855F7");
  assert.equal(field.validate("#a855f7").value, "#A855F7");
  assert.equal(field.validate("  #A855F7  ").value, "#A855F7");
});

test("clearing an optional text field is allowed", async () => {
  const Model = mongoose.model("guild");

  for (const { name, field, path } of everyField()) {
    if (field.type !== "text" || field.required !== false) continue;

    const document = new Model({ _id: "123456789012345678" });
    // The modal stores null when somebody submits an empty box.
    writePath(document, path, null);

    await assert.doesNotReject(() => document.validate([path]), `${name}.${field.id} cannot be cleared`);
  }
});
