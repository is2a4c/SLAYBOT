const test = require("node:test");
const assert = require("node:assert/strict");
require("module-alias/register");

const captcha = require("../src/services/verification/Captcha");
const { buildPanel, checkEligibility, BUTTON_ID } = require("../src/handlers/verification");

const VERIFIED_ROLE = "111111111111111111";
const GUILD_ID = "222222222222222222";

test("captcha codes avoid ambiguous glyphs and honour the length bounds", () => {
  for (let i = 0; i < 50; i += 1) {
    const code = captcha.generateCode(6);
    assert.equal(code.length, 6);
    assert.ok(!/[01OI]/.test(code), `ambiguous glyph in ${code}`);
    assert.ok([...code].every((char) => captcha.ALPHABET.includes(char)));
  }

  assert.equal(captcha.generateCode(1).length, captcha.MIN_LENGTH);
  assert.equal(captcha.generateCode(99).length, captcha.MAX_LENGTH);
});

test("code comparison ignores case and whitespace but nothing else", () => {
  assert.equal(captcha.matchesCode("AB3D5F", "ab3d5f"), true);
  assert.equal(captcha.matchesCode("AB3D5F", " AB 3D 5F "), true);
  assert.equal(captcha.matchesCode("AB3D5F", "AB3D5G"), false);
  assert.equal(captcha.matchesCode("AB3D5F", ""), false);
  assert.equal(captcha.matchesCode("", ""), false);
});

test("the captcha image renders every character and is deterministic per code", () => {
  const svg = captcha.renderCaptchaSvg("AB3D5F");

  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  for (const char of "AB3D5F") {
    assert.ok(svg.includes(`>${char}</text>`), `missing glyph ${char}`);
  }
  assert.match(svg, /<line /, "noise lines are drawn");
  assert.equal(svg, captcha.renderCaptchaSvg("AB3D5F"), "the same code renders identically");
  assert.notEqual(svg, captcha.renderCaptchaSvg("AB3D5G"), "a different code renders differently");
});

test("the captcha rasterises to a PNG", async () => {
  const image = await captcha.renderCaptchaImage("AB3D5F");

  assert.equal(image.name, "captcha.png");
  assert.ok(Buffer.isBuffer(image.attachment));
  assert.deepEqual(image.attachment.subarray(1, 4), Buffer.from("PNG"), "PNG magic bytes");
});

/* ------------------------------------------------------------- eligibility */

const config = (overrides = {}) => ({
  enabled: true,
  mode: "BUTTON",
  role_id: VERIFIED_ROLE,
  ...overrides,
});

test("a member without the role may verify", () => {
  const result = checkEligibility({
    config: config(),
    memberRoleIds: [GUILD_ID],
    botHighest: 10,
    rolePosition: 4,
  });

  assert.deepEqual(result, { ok: true, reason: null });
});

test("verification is refused when it is off, unconfigured, or already done", () => {
  assert.match(
    checkEligibility({ config: config({ enabled: false }), memberRoleIds: [], botHighest: 10, rolePosition: 4 }).reason,
    /not enabled/
  );
  assert.match(
    checkEligibility({ config: config({ role_id: null }), memberRoleIds: [], botHighest: 10, rolePosition: 4 }).reason,
    /No verified role/
  );
  assert.match(
    checkEligibility({ config: config(), memberRoleIds: [VERIFIED_ROLE], botHighest: 10, rolePosition: 4 }).reason,
    /already verified/
  );
});

test("verification is refused when the bot cannot assign the role", () => {
  assert.match(
    checkEligibility({ config: config(), memberRoleIds: [], botHighest: 10, rolePosition: null }).reason,
    /no longer exists/
  );
  assert.match(
    checkEligibility({ config: config(), memberRoleIds: [], botHighest: 3, rolePosition: 7 }).reason,
    /move my role higher/
  );
  assert.match(
    checkEligibility({ config: config(), memberRoleIds: [], botHighest: 10, rolePosition: 4, roleManaged: true })
      .reason,
    /managed by an integration/
  );
});

test("the panel carries the verify button and explains the active mode", () => {
  const buttonPanel = buildPanel(config());
  assert.equal(buttonPanel.components[0].components[0].data.custom_id, BUTTON_ID);
  assert.match(buttonPanel.embeds[0].data.description, /confirm you are human/);

  const captchaPanel = buildPanel(config({ mode: "CAPTCHA" }));
  assert.match(captchaPanel.embeds[0].data.description, /read the code from the image/i);

  const custom = buildPanel(config({ description: "Read #rules first.", button_label: "Let me in" }));
  assert.equal(custom.embeds[0].data.description, "Read #rules first.");
  assert.equal(custom.components[0].components[0].data.label, "Let me in");
});

/* ------------------------------------------------------------ answer timing */

const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const { handleVerifyButton } = require("../src/handlers/verification");

/**
 * Records the order the interaction was answered in, so slow work — the
 * database write and the image encoder — cannot creep back in front of the
 * acknowledgement and blow the three second deadline.
 *
 * @param {{held?: string[]}} [options]
 */
function fakeInteraction({ held = [] } = {}) {
  const calls = [];
  const roles = {
    cache: { has: (id) => held.includes(id), map: (fn) => held.map((id) => fn({ id })) },
    add: async () => calls.push("roles.add"),
  };

  const guild = {
    id: GUILD_ID,
    roles: { cache: new Map([[VERIFIED_ROLE, { id: VERIFIED_ROLE, position: 1, managed: false }]]) },
    members: { me: { roles: { highest: { position: 10 } } } },
    channels: { cache: new Map() },
  };

  return {
    calls,
    guild,
    guildId: GUILD_ID,
    user: { id: "888888888888888888" },
    client: { logger: { error: () => {} } },
    member: { id: "888888888888888888", guild, roles },
    deferReply: async () => calls.push("deferReply"),
    editReply: async () => calls.push("editReply"),
    reply: async () => calls.push("reply"),
  };
}

test("a captcha challenge acknowledges the click before building anything", async () => {
  const mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());

  try {
    const interaction = fakeInteraction();

    await handleVerifyButton(interaction, {
      verification: { enabled: true, mode: "CAPTCHA", role_id: VERIFIED_ROLE, captcha_length: 6 },
    });

    assert.equal(interaction.calls[0], "deferReply", "the challenge is built after the click is acknowledged");
    assert.ok(interaction.calls.includes("editReply"), "the image replaces the placeholder");
    assert.ok(!interaction.calls.includes("reply"), "a bare reply would race the deadline");
  } finally {
    await mongoose.disconnect();
    await mongo.stop();
  }
});

test("an ineligible member is answered in one message, without a placeholder", async () => {
  const interaction = fakeInteraction({ held: [VERIFIED_ROLE] });

  await handleVerifyButton(interaction, {
    verification: { enabled: true, mode: "BUTTON", role_id: VERIFIED_ROLE },
  });

  assert.deepEqual(interaction.calls, ["reply"], "a refusal needs no placeholder");
});
