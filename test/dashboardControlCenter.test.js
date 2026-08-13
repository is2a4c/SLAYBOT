const test = require("node:test");
const assert = require("node:assert/strict");
require("module-alias/register");
require("@schemas/Guild");

const mongoose = require("mongoose");
const {
  CONTROL_MODULES,
  buildControlPatch,
  findModule,
  moduleForView,
} = require("../dashboard/services/controlCenter");

const TEXT_ID = "100000000000000001";
const VOICE_ID = "100000000000000002";
const CATEGORY_ID = "100000000000000003";
const ROLE_ID = "100000000000000004";
const BAD_ID = "100000000000000009";

function mockGuild() {
  return {
    id: "100000000000000000",
    channels: {
      cache: new Map([
        [TEXT_ID, { id: TEXT_ID, type: 0, isTextBased: () => true, isThread: () => false }],
        [VOICE_ID, { id: VOICE_ID, type: 2, isTextBased: () => false, isThread: () => false }],
        [CATEGORY_ID, { id: CATEGORY_ID, type: 4, isTextBased: () => false, isThread: () => false }],
      ]),
    },
    roles: { cache: new Map([[ROLE_ID, { id: ROLE_ID }]]) },
  };
}

test("control center fields are unique and point to guild schema paths", () => {
  const schema = mongoose.model("guild").schema;
  const fields = CONTROL_MODULES.flatMap((module) => module.groups.flatMap((group) => group.fields));
  const ids = fields.map((field) => `${field.path}:${field.id}`);
  assert.equal(new Set(ids).size, ids.length);
  for (const field of fields) assert.ok(schema.path(field.path), `${field.id}: ${field.path}`);
});

test("control parser updates runtime settings and ignores staged settings", () => {
  const module = findModule("moderation");
  const patch = buildControlPatch(
    mockGuild(),
    {
      moderatorRoles: [ROLE_ID, BAD_ID, ROLE_ID],
      warningExpiry: "9000",
      warningAction: "INVALID",
      muteRole: BAD_ID,
      muteExcluded: [TEXT_ID, VOICE_ID],
      antiCaps: "on",
      capsPercent: "4",
    },
    {
      max_warn: { action: "BAN" },
      control_center: { moderation: { warning_expiry_days: 30 } },
    },
    module
  );

  assert.equal(patch["control_center.moderation.moderator_roles"], undefined);
  assert.equal(patch["control_center.moderation.warning_expiry_days"], undefined);
  assert.equal(patch["max_warn.action"], "BAN");
  assert.equal(patch["control_center.moderation.mute_role"], undefined);
  assert.equal(patch["control_center.moderation.anti_caps"], undefined);
  assert.equal(patch["automod.anti_links"], false);
});

test("control view isolates one module and preserves current values", () => {
  assert.equal(findModule("missing"), null);
  const view = moduleForView(findModule("common"), {
    prefix: "?",
    language: null,
    control_center: { common: { timezone: "UTC" } },
  });
  assert.equal(view.id, "common");
  assert.equal(view.groups[0].fields.find((field) => field.id === "prefix").value, "?");
  assert.equal(view.groups[0].fields.find((field) => field.id === "timezone").value, "UTC");
});
