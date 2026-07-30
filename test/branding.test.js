const test = require("node:test");
const assert = require("node:assert/strict");
require("module-alias/register");

const { EmbedBuilder } = require("discord.js");
const { MAX_FOOTER, MAX_NAME, applyBranding, resolveBranding, sanitizeBranding } = require("../src/helpers/Branding");
const { brandEmbed } = require("../src/helpers/EmbedUtils");
const { buildStickyPayload } = require("../src/handlers/stickyMessages");
const { buildPanelEmbed } = require("../src/helpers/SelfRoles");

const client = {
  user: { username: "SLAYBOT", displayAvatarURL: () => "https://cdn/bot.png" },
};

const settings = (branding) => ({ branding });

test("branding input is cleaned and clearly rejected when wrong", () => {
  const ok = sanitizeBranding({
    name: "  Guild Bot  ",
    color: "#a855f7",
    footer: "My server",
    iconURL: "https://cdn/icon.png",
  });

  assert.deepEqual(ok.errors, []);
  assert.equal(ok.branding.name, "Guild Bot");
  assert.equal(ok.branding.color, "#A855F7");
  assert.equal(ok.branding.iconURL, "https://cdn/icon.png");

  const bad = sanitizeBranding({
    name: "x".repeat(MAX_NAME + 1),
    color: "purple",
    footer: "y".repeat(MAX_FOOTER + 1),
    iconURL: "http://cdn/icon.png",
  });

  assert.equal(bad.errors.length, 4);
  assert.match(bad.errors.join(" "), /at most 60 characters/);
  assert.match(bad.errors.join(" "), /hex value/);
  assert.match(bad.errors.join(" "), /https URL/);
});

test("an empty string clears a branding field", () => {
  const { branding, errors } = sanitizeBranding({ name: "  ", color: "", footer: "", iconURL: "" });

  assert.deepEqual(errors, []);
  assert.deepEqual(branding, { name: null, color: null, footer: null, iconURL: null });
});

test("branding falls back to the bot's own identity", () => {
  const fallback = resolveBranding(null, client);
  assert.equal(fallback.name, "SLAYBOT");
  assert.equal(fallback.iconURL, "https://cdn/bot.png");
  assert.equal(fallback.footer, null);

  const custom = resolveBranding(settings({ name: "Guild Bot", color: "#123456", footer: "hi" }), client);
  assert.equal(custom.name, "Guild Bot");
  assert.equal(custom.color, "#123456");
  assert.equal(custom.footer, "hi");
});

test("applying branding does not overwrite a colour a command chose deliberately", () => {
  const branded = resolveBranding(settings({ color: "#123456", footer: "My server" }), client);

  const neutral = applyBranding(new EmbedBuilder(), branded);
  assert.equal(neutral.data.color, 0x123456);
  assert.equal(neutral.data.footer.text, "My server");

  const deliberate = applyBranding(new EmbedBuilder().setColor("#ED4245"), branded);
  assert.equal(deliberate.data.color, 0xed4245, "an error embed stays red");

  const forced = applyBranding(new EmbedBuilder().setColor("#ED4245"), branded, { force: true });
  assert.equal(forced.data.color, 0x123456);
});

test("brandEmbed uses the guild accent for neutral embeds and keeps semantic colours", () => {
  const guildSettings = settings({ color: "#123456", footer: "My server" });

  const neutral = brandEmbed(client, "DEFAULT", { settings: guildSettings }).data;
  assert.equal(neutral.color, 0x123456);
  assert.equal(neutral.footer.text, "My server");

  const error = brandEmbed(client, "ERROR", { settings: guildSettings }).data;
  assert.notEqual(error.color, 0x123456, "an error embed keeps the error colour");

  const noSettings = brandEmbed(client, "DEFAULT").data;
  assert.equal(noSettings.footer.text, "SLAYBOT");
});

test("panels and stickies follow the server branding unless they set their own colour", () => {
  const guildSettings = settings({ color: "#123456", footer: "My server" });

  const panel = buildPanelEmbed(
    { title: "Roles", roles: [], message_id: "1" },
    { settings: guildSettings, client }
  ).data;
  assert.equal(panel.color, 0x123456);
  assert.equal(panel.footer.text, "My server");

  const ownColour = buildPanelEmbed(
    { title: "Roles", roles: [], color: "#FFCC00", message_id: "1" },
    { settings: guildSettings, client }
  ).data;
  assert.equal(ownColour.color, 0xffcc00);

  const sticky = buildStickyPayload({ embed: true, content: "read the rules" }, { settings: guildSettings, client });
  assert.equal(sticky.embeds[0].data.color, 0x123456);

  const plain = buildStickyPayload({ embed: false, content: "read the rules" }, { settings: guildSettings, client });
  assert.deepEqual(plain, { content: "read the rules" });
});
