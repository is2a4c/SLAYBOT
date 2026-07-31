const test = require("node:test");
const assert = require("node:assert/strict");
require("module-alias/register");

const {
  ACTION_IDS,
  ACTION_ROWS,
  MEMBER_PICKERS,
  buildPanel,
  buttonId,
  modalId,
  parse,
  selectId,
} = require("@src/services/tempvoice/panel");
const {
  checkClaim,
  checkControl,
  checkTarget,
  normalizeLimit,
  normalizeName,
  renderChannelName,
} = require("@src/services/tempvoice/rules");
const { translate } = require("@src/i18n");

const OWNER = "111111111111111111";
const OTHER = "222222222222222222";
const THIRD = "333333333333333333";

const record = (overrides = {}) => ({ owner_id: OWNER, trusted: [], blocked: [], ...overrides });
const t = (key, vars) => translate("ru", key, vars);

/* -------------------------------------------------------------------- panel */

test("the panel is three rows of five buttons", () => {
  const panel = buildPanel(t, {});

  assert.equal(panel.components.length, 3);
  for (const row of panel.components) assert.equal(row.components.length, 5);
  assert.equal(ACTION_IDS.length, 15);
  assert.equal(new Set(ACTION_IDS).size, 15, "action ids are unique");
});

test("every button carries its own custom id and an icon", () => {
  const panel = buildPanel(t, {});
  const buttons = panel.components.flatMap((row) => row.components.map((button) => button.data));

  assert.deepEqual(
    buttons.map((button) => button.custom_id),
    ACTION_IDS.map(buttonId)
  );
  for (const button of buttons) assert.ok(button.emoji, `${button.custom_id} has no emoji`);
});

test("the embed legend names every button in the reader's language", () => {
  const description = buildPanel(t, {}).embeds[0].data.description;

  for (const action of ACTION_ROWS.flat()) {
    assert.ok(
      description.includes(`${action.emoji} ${t(`tempvoice.actions.${action.id}`)}`),
      `${action.id} is missing from the legend`
    );
  }

  assert.ok(buildPanel((key) => translate("en", key), {}).embeds[0].data.description.includes("Delete"));
});

test("custom ids stay parseable back into an action and a channel", () => {
  assert.deepEqual(parse(selectId("kick", "444444444444444444")), {
    kind: "select",
    action: "kick",
    ref: "444444444444444444",
  });
  assert.deepEqual(parse(modalId("name", "555")), { kind: "modal", action: "name", ref: "555" });
  assert.deepEqual(parse(buttonId("name")), { kind: "button", action: "name", ref: "" });
  assert.equal(parse("SOMETHING_ELSE:name"), null);
});

test("every action that needs a member has a prompt to ask with", () => {
  for (const [action, key] of Object.entries(MEMBER_PICKERS)) {
    assert.ok(ACTION_IDS.includes(action), `${action} is not a panel button`);
    assert.notEqual(t(`tempvoice.prompts.${key}`), `tempvoice.prompts.${key}`, `${key} is not translated`);
  }
});

/* ---------------------------------------------------------------- ownership */

test("only the owner drives the buttons", () => {
  assert.deepEqual(checkControl({ record: record(), userId: OWNER }), { ok: true, reason: null, owner: OWNER });

  const denied = checkControl({ record: record(), userId: OTHER });
  assert.equal(denied.ok, false);
  assert.equal(denied.reason, "notOwner");
  assert.equal(denied.owner, OWNER, "the reply can name who to ask");
});

test("a channel with no record is not a temporary channel", () => {
  assert.deepEqual(checkControl({ record: null, userId: OWNER }), { ok: false, reason: "notTemporary", owner: null });
  assert.equal(checkClaim({ record: null, userId: OWNER, memberIds: [] }).reason, "notTemporary");
});

test("claiming waits for the owner to leave", () => {
  assert.equal(checkClaim({ record: record(), userId: OTHER, memberIds: [OWNER, OTHER] }).reason, "ownerPresent");
  assert.equal(checkClaim({ record: record(), userId: OTHER, memberIds: [OTHER] }).ok, true);
  assert.equal(checkClaim({ record: record(), userId: OTHER, memberIds: new Set([OTHER]) }).ok, true);
  assert.equal(checkClaim({ record: record(), userId: OWNER, memberIds: [OWNER] }).reason, "alreadyOwner");
});

test("actions refuse yourself, bots and the owner", () => {
  const base = { record: record(), actorId: OWNER };

  assert.equal(checkTarget({ ...base, targetId: OWNER }).reason, "targetIsSelf");
  assert.equal(checkTarget({ ...base, targetId: OTHER, isBot: true }).reason, "targetIsBot");
  assert.equal(
    checkTarget({ record: record({ owner_id: THIRD }), actorId: OWNER, targetId: THIRD }).reason,
    "targetIsOwner"
  );
  assert.equal(checkTarget({ ...base, targetId: OTHER }).ok, true);
});

test("undoing an earlier action may target the owner", () => {
  const input = { record: record({ owner_id: THIRD }), actorId: OWNER, targetId: THIRD, allowOwner: true };

  assert.equal(checkTarget(input).ok, true);
});

/* ------------------------------------------------------------- input tidying */

test("a channel name is trimmed and bounded", () => {
  assert.equal(normalizeName("  Ночной   лаунж  ").value, "Ночной лаунж");
  assert.equal(normalizeName("").reason, "nameLength");
  assert.equal(normalizeName("   ").reason, "nameLength");
  assert.equal(normalizeName("x".repeat(101)).reason, "nameLength");
  assert.equal(normalizeName("x".repeat(100)).ok, true);
});

test("a member limit is a whole number from 0 to 99", () => {
  assert.equal(normalizeLimit("0").value, 0);
  assert.equal(normalizeLimit(" 12 ").value, 12);
  assert.equal(normalizeLimit("99").value, 99);
  assert.equal(normalizeLimit("100").reason, "limitRange");
  assert.equal(normalizeLimit("-1").reason, "limitRange");
  assert.equal(normalizeLimit("4.5").reason, "limitRange");
  assert.equal(normalizeLimit("").reason, "limitRange");
});

test("new channels are named from the template", () => {
  assert.equal(renderChannelName("{user}", { user: "Isaac" }), "Isaac");
  assert.equal(renderChannelName("🎧 {user} #{count}", { user: "Isaac", count: 2 }), "🎧 Isaac #2");
  assert.equal(renderChannelName("", { user: "Isaac" }), "Isaac");
  assert.equal(renderChannelName("{count}", { user: "Isaac", count: 1 }), "1");
  assert.equal(renderChannelName("{user}", { user: "x".repeat(120) }).length, 100);
});
