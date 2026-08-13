const test = require("node:test");
const assert = require("node:assert/strict");
require("module-alias/register");
require("@schemas/Guild");

const mongoose = require("mongoose");
const {
  ADVANCED_FIELDS,
  buildAdvancedPatch,
  fieldsForView,
  shouldRepublishTicketPanel,
} = require("../dashboard/services/advancedSettings");

const TEXT_ID = "100000000000000001";
const VOICE_ID = "100000000000000002";
const CATEGORY_ID = "100000000000000003";
const ROLE_ID = "100000000000000004";
const BAD_ID = "100000000000000009";

function mockGuild() {
  const channels = new Map([
    [TEXT_ID, { id: TEXT_ID, type: 0, isTextBased: () => true, isThread: () => false }],
    [VOICE_ID, { id: VOICE_ID, type: 2, isTextBased: () => false, isThread: () => false }],
    [CATEGORY_ID, { id: CATEGORY_ID, type: 4, isTextBased: () => false, isThread: () => false }],
  ]);
  return { channels: { cache: channels }, roles: { cache: new Map([[ROLE_ID, { id: ROLE_ID }]]) } };
}

test("every advanced field points to a real guild schema path", () => {
  const schema = mongoose.model("guild").schema;
  for (const field of ADVANCED_FIELDS) assert.ok(schema.path(field.path), `${field.id}: ${field.path}`);
});

test("complex feature sections expose every scalar guild setting", () => {
  const schema = mongoose.model("guild").schema;
  const exposed = new Set(ADVANCED_FIELDS.map((field) => field.path));
  const groups = ["ticket", "welcome", "farewell", "starboard", "suggestions", "modmail"];
  const internalOrCollection = new Set(["ticket.panel_message_id", "ticket.categories"]);

  for (const path of Object.keys(schema.paths)) {
    if (!groups.some((group) => path.startsWith(`${group}.`))) continue;
    if (path.includes(".$") || internalOrCollection.has(path)) continue;
    assert.ok(exposed.has(path), `${path} is not available in the advanced dashboard`);
  }
});

test("advanced settings expose every declared field exactly once", () => {
  const ids = ADVANCED_FIELDS.map((field) => field.id);
  const paths = ADVANCED_FIELDS.map((field) => field.path);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(new Set(paths).size, paths.length);

  const viewFields = fieldsForView({ ai: { enabled: true } }).flatMap((section) => section.fields);
  assert.equal(viewFields.length, ADVANCED_FIELDS.length);
  assert.equal(viewFields.find((field) => field.id === "aiEnabled").value, true);
});

test("advanced parser validates Discord objects, bounds, lists and formats", () => {
  const settings = {
    max_warn: { limit: 5 },
    branding: { color: "#112233", iconURL: "https://old.example/icon.png" },
    ai: { automod_mode: "SHADOW" },
  };
  const patch = buildAdvancedPatch(
    mockGuild(),
    {
      warnLimit: "999",
      brandColor: "a855f7",
      brandIcon: "http://unsafe.example/icon.png",
      aiMode: "INVALID",
      tempVoiceHub: VOICE_ID,
      tempVoiceCategory: TEXT_ID,
      verificationRole: ROLE_ID,
      birthdaysRole: BAD_ID,
      ticketStaff: `${ROLE_ID}, ${ROLE_ID}, ${BAD_ID}`,
      starboardIgnored: `${TEXT_ID}, ${VOICE_ID}, ${BAD_ID}`,
    },
    settings
  );

  assert.equal(patch["max_warn.limit"], 20);
  assert.equal(patch["branding.color"], "#A855F7");
  assert.equal(patch["branding.iconURL"], "https://old.example/icon.png");
  assert.equal(patch["ai.automod_mode"], "SHADOW");
  assert.equal(patch["temp_voice.hub_channel_id"], VOICE_ID);
  assert.equal(patch["temp_voice.category_id"], null);
  assert.equal(patch["verification.role_id"], ROLE_ID);
  assert.equal(patch["birthdays.role_id"], null);
  assert.deepEqual(patch["ticket.staff_roles"], [ROLE_ID]);
  assert.deepEqual(patch["starboard.ignored_channels"], [TEXT_ID]);
});

test("unchecked advanced switches are explicitly disabled", () => {
  const patch = buildAdvancedPatch(mockGuild(), {}, { ai: { enabled: true }, modmail: { enabled: true } });
  assert.equal(patch["ai.enabled"], false);
  assert.equal(patch["modmail.enabled"], false);
});

test("ticket panel is republished only when its public card changes", () => {
  const settings = {
    ticket: {
      panel_channel_id: TEXT_ID,
      panel_message_id: "100000000000000010",
      panel_title: "Support",
      panel_description: "Open here",
    },
    branding: { color: "#112233" },
  };

  assert.equal(shouldRepublishTicketPanel(settings, { "ticket.limit": 20 }), false);
  assert.equal(shouldRepublishTicketPanel(settings, { "ticket.panel_title": "Help" }), true);
  assert.equal(shouldRepublishTicketPanel(settings, { "ticket.panel_channel_id": null }), true);
  assert.equal(shouldRepublishTicketPanel(settings, { "branding.color": "#A855F7" }), true);
  assert.equal(
    shouldRepublishTicketPanel(
      { ticket: { panel_channel_id: null, panel_message_id: null }, branding: {} },
      { "ticket.panel_title": "Help", "ticket.panel_channel_id": null }
    ),
    false
  );
  assert.equal(
    shouldRepublishTicketPanel(
      { ticket: { panel_channel_id: TEXT_ID, panel_message_id: null }, branding: {} },
      { "ticket.limit": 20, "ticket.panel_channel_id": TEXT_ID }
    ),
    true,
    "a configured panel missing its message is repaired on save"
  );
});
