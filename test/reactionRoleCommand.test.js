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

  assert.equal(response, "Done! Saved 2 reaction roles for this message.");
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

function createRole(id, position) {
  return {
    id,
    position,
    managed: false,
    toString: () => `<@&${id}>`,
  };
}
