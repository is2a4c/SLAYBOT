const test = require("node:test");
const assert = require("node:assert/strict");
require("module-alias/register");

const { buildIncomingEmbed, buildReplyEmbed, resolveTargetGuild } = require("../src/handlers/modmail");

test("a single shared guild with modmail enabled is picked automatically", () => {
  const result = resolveTargetGuild({
    guilds: [
      { id: "1", enabled: true },
      { id: "2", enabled: false },
    ],
  });

  assert.deepEqual(result, { guildId: "1", error: null });
});

test("no enabled guild means no thread and a clear reason", () => {
  const result = resolveTargetGuild({ guilds: [{ id: "1", enabled: false }] });

  assert.equal(result.guildId, null);
  assert.match(result.error, /none of the servers we share have modmail enabled/i);
});

test("several enabled guilds ask the member to use the command in the right server", () => {
  const result = resolveTargetGuild({
    guilds: [
      { id: "1", enabled: true },
      { id: "2", enabled: true },
    ],
  });

  assert.equal(result.guildId, null);
  assert.match(result.error, /\/modmail contact/);
});

test("an incoming DM keeps the author id and lists attachments", () => {
  const user = {
    id: "567890123456789012",
    username: "ann",
    globalName: "Ann",
    displayAvatarURL: () => "https://cdn/a.png",
  };
  const attachments = new Map([["1", { name: "proof.png", url: "https://cdn/proof.png" }]]);

  const embed = buildIncomingEmbed(user, { content: "help please", attachments }).data;

  assert.match(embed.author.name, /Ann · 567890123456789012/);
  assert.equal(embed.description, "help please");
  assert.match(embed.fields[0].value, /proof\.png/);
});

test("an empty DM still produces a valid embed", () => {
  const user = { id: "1", username: "ann", globalName: null, displayAvatarURL: () => "" };
  const embed = buildIncomingEmbed(user, { content: "", attachments: new Map() }).data;

  assert.equal(embed.description, "_no text_");
});

test("staff replies can hide the responder behind the server name", () => {
  const guild = { name: "Slay", iconURL: () => "https://cdn/icon.png" };

  const named = buildReplyEmbed(guild, "Mod Bob", "on it", false).data;
  assert.equal(named.author.name, "Mod Bob · Slay");

  const anonymous = buildReplyEmbed(guild, "Mod Bob", "on it", true).data;
  assert.equal(anonymous.author.name, "Slay staff");
  assert.ok(!JSON.stringify(anonymous).includes("Bob"), "the staff name must not leak anywhere in the payload");
});
