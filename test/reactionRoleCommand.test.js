const test = require("node:test");
const assert = require("node:assert/strict");
require("module-alias/register");

const reactionRoleSchema = require("../src/database/schemas/ReactionRoles");

test("setrr saves every comma-separated emoji and role in one replacement", async () => {
  const saved = [];
  const reactions = [];
  const originalGet = reactionRoleSchema.getReactionRoles;
  const originalReplace = reactionRoleSchema.replaceReactionRoles;

  reactionRoleSchema.getReactionRoles = () => [];
  reactionRoleSchema.replaceReactionRoles = async (...args) => saved.push(args);
  delete require.cache[require.resolve("../src/commands/admin/reaction-role/setrr")];
  const { setReactionRoles } = require("../src/commands/admin/reaction-role/setrr");

  const firstRole = createRole("123456789012345678", 5);
  const secondRole = createRole("234567890123456789", 6);
  const targetMessage = {
    id: "message-id",
    react: async (emoji) => reactions.push(emoji),
    reactions: { resolve: () => undefined },
  };
  const botMember = {
    id: "bot-id",
    roles: { highest: { position: 10 } },
  };
  const guild = {
    id: "guild-id",
    emojis: { cache: new Map() },
    roles: {
      cache: new Map([
        [firstRole.id, firstRole],
        [secondRole.id, secondRole],
      ]),
      everyone: { id: "guild-id" },
    },
    members: { me: botMember },
  };
  const channel = {
    id: "channel-id",
    permissionsFor: () => ({ has: () => true }),
    messages: { fetch: async () => targetMessage },
  };

  const response = await setReactionRoles(
    guild,
    channel,
    targetMessage.id,
    `😀 <@&${firstRole.id}>, 🎮 <@&${secondRole.id}>`
  );

  // The outcome is a key and its values, so the panel and the command can each
  // say it in the language of the server they are configuring.
  assert.deepEqual(response, { ok: true, key: "reactionRoles.saved", vars: { count: 2 } });
  assert.deepEqual(reactions, ["😀", "🎮"]);
  assert.deepEqual(saved, [
    [
      guild.id,
      channel.id,
      targetMessage.id,
      [
        { emote: "😀", role_id: firstRole.id },
        { emote: "🎮", role_id: secondRole.id },
      ],
    ],
  ]);

  reactionRoleSchema.getReactionRoles = originalGet;
  reactionRoleSchema.replaceReactionRoles = originalReplace;
});

test("every outcome reaction roles can report is translated in both languages", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const { LOCALES, translate } = require("@src/i18n");

  // The keys are chosen in code and only ever resolved at run time, so nothing
  // else would notice one being renamed on one side and not the other.
  const sources = [
    "src/services/roles/ReactionRoleSetup.js",
    "src/helpers/ReactionRoleMappings.js",
    "src/commands/admin/reaction-role/setrr.js",
    "src/commands/admin/reaction-role/addrr.js",
    "src/commands/admin/reaction-role/removerr.js",
  ].map((file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8"));

  const keys = new Set();
  for (const source of sources) {
    for (const [, key] of source.matchAll(/["'`](reactionRoles\.\w+)["'`]/g)) keys.add(key);
  }

  assert.ok(keys.size >= 12, `only ${keys.size} outcomes found — the search stopped matching`);

  for (const key of keys) {
    for (const locale of Object.keys(LOCALES)) {
      assert.notEqual(translate(locale, key), key, `${key} has no ${locale} wording`);
    }
  }
});

function createRole(id, position) {
  return {
    id,
    position,
    managed: false,
    toString: () => `<@&${id}>`,
  };
}
