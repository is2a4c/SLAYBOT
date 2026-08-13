const test = require("node:test");
const assert = require("node:assert/strict");
require("module-alias/register");
require("@schemas/Guild");

const mongoose = require("mongoose");
const { ADVANCED_FIELDS, buildAdvancedPatch, fieldsForView } = require("../dashboard/services/advancedSettings");

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
