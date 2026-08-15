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

test("no two fields write the same schema path - one would silently discard the other's edit on save", () => {
  const fields = CONTROL_MODULES.flatMap((module) => module.groups.flatMap((group) => group.fields));
  const byPath = new Map();
  for (const field of fields) {
    const existing = byPath.get(field.path);
    assert.equal(existing, undefined, `${field.path} is claimed by both "${existing}" and "${field.id}"`);
    byPath.set(field.path, field.id);
  }
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

test("both command switches are live now that the command policy enforces them", () => {
  const common = findModule("common");
  const fields = common.groups.flatMap((group) => group.fields);
  assert.equal(fields.find((field) => field.id === "textCommands").runtime, true);
  assert.equal(fields.find((field) => field.id === "slashCommands").runtime, true);

  const patch = buildControlPatch(
    mockGuild(),
    { textCommands: "on" },
    { control_center: { common: { text_commands: false, slash_commands: true } } },
    common
  );
  assert.equal(patch["control_center.common.text_commands"], true);
  assert.equal(patch["control_center.common.slash_commands"], false, "an unchecked switch is stored as off");
});

test("notification controls backed by event handlers are live", () => {
  const fields = findModule("notifications").groups.flatMap((group) => group.fields);
  for (const id of [
    "welcomeDm",
    "boostEnabled",
    "boostChannel",
    "boostMessage",
    "dmBan",
    "dmKick",
    "dmMute",
    "dmWarn",
  ]) {
    assert.equal(fields.find((field) => field.id === id).runtime, true, id);
  }
});

test("ranking controls are live: ignore rules, multipliers, public page and card style", () => {
  const fields = findModule("ranking").groups.flatMap((group) => group.fields);
  for (const id of [
    "publicRanking",
    "resetOnLeave",
    "rankingIgnoredRoles",
    "rankingIgnoredText",
    "textMultiplier",
    "voiceRanking",
    "rankingIgnoredVoice",
    "voiceMultiplier",
    "rankingMaxMembers",
    "rankCardAccent",
    "rankCardBackground",
  ]) {
    assert.equal(fields.find((field) => field.id === id).runtime, true, id);
  }
});

test("every fun-module control is live: roulette and Forest Fuss both have a runtime behind them now", () => {
  const fields = findModule("fun").groups.flatMap((group) => group.fields);

  for (const id of [
    "roulette",
    "forestFuss",
    "fussCategory",
    "fussSessions",
    "fussPlayers",
    "fussLobby",
    "fussWolves",
    "fussLeaders",
    "fussRecruitment",
    "fussDay",
    "fussNight",
    "fussResults",
  ]) {
    assert.equal(fields.find((field) => field.id === id).runtime, true, id);
  }
});

test("music controls are live, matching the settings src/services/music/policy.js already reads", () => {
  const fields = findModule("music").groups.flatMap((group) => group.fields);
  for (const id of [
    "musicChannel",
    "musicAnyChannel",
    "djRoles",
    "musicSource",
    "compactQueue",
    "deleteMusicNotices",
    "progressBar",
    "queueLimit",
    "trackLimit",
    "autoplay",
    "autoplayQuery",
    "autoplayChannel",
  ]) {
    assert.equal(fields.find((field) => field.id === id).runtime, true, id);
  }
});

test("AI controls are live and point at the same ai.* paths src/commands/admin/ai.js reads", () => {
  const fields = findModule("ai").groups.flatMap((group) => group.fields);
  for (const id of [
    "aiEnabled",
    "aiAutomod",
    "aiMode",
    "aiThreshold",
    "aiTickets",
    "aiSuggestions",
    "aiForms",
    "aiKnowledge",
    "aiKnowledgeText",
  ]) {
    assert.equal(fields.find((field) => field.id === id).runtime, true, id);
  }
});

test("AI control patch validates the automod mode and threshold, and stores the knowledge text", () => {
  const ai = findModule("ai");
  const patch = buildControlPatch(
    mockGuild(),
    {
      aiAutomod: "on",
      aiMode: "INVALID",
      aiThreshold: "40",
      aiKnowledgeText: "Verification requires /verify.",
    },
    { ai: { automod_mode: "ENFORCE", automod_threshold: 85 } },
    ai
  );

  assert.equal(patch["ai.enabled"], false, "an unchecked switch is stored as off");
  assert.equal(patch["ai.automod_enabled"], true);
  assert.equal(patch["ai.automod_mode"], "ENFORCE", "an invalid choice keeps the current value");
  assert.equal(patch["ai.automod_threshold"], 50, "the threshold clamps to its 50-100 range");
  assert.equal(patch["ai.knowledge"], "Verification requires /verify.");
});
