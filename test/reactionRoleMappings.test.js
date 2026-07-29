const test = require("node:test");
const assert = require("node:assert/strict");
require("module-alias/register");

const {
  MAX_REACTION_ROLES,
  normalizeReactionEmoji,
  parseReactionRoleMappings,
} = require("../src/helpers/ReactionRoleMappings");

const roleOne = "123456789012345678";
const roleTwo = "234567890123456789";

test("parses emoji-role pairs separated by commas", () => {
  assert.deepEqual(parseReactionRoleMappings(`😀 <@&${roleOne}>, 🎮 <@&${roleTwo}>`), [
    { reaction: "😀", roleId: roleOne },
    { reaction: "🎮", roleId: roleTwo },
  ]);
});

test("also accepts explicit separators and new lines", () => {
  assert.deepEqual(parseReactionRoleMappings(`❤️ -> ${roleOne}\n👍 = <@&${roleTwo}>`), [
    { reaction: "❤️", roleId: roleOne },
    { reaction: "👍", roleId: roleTwo },
  ]);
});

test("rejects malformed and oversized mapping lists with actionable errors", () => {
  assert.throws(() => parseReactionRoleMappings("😀 = not-a-role"), /Pair 1 is invalid/);
  assert.throws(
    () => parseReactionRoleMappings(Array.from({ length: MAX_REACTION_ROLES + 1 }, () => `😀 = ${roleOne}`).join("|")),
    /at most 20/
  );
});

test("normalizes server custom emoji and validates unicode emoji", () => {
  const guild = {
    emojis: {
      cache: new Map([["345678901234567890", {}]]),
    },
  };

  assert.equal(normalizeReactionEmoji("<:vip:345678901234567890>", guild), "345678901234567890");
  assert.equal(normalizeReactionEmoji("👨‍👩‍👧‍👦", guild), "👨‍👩‍👧‍👦");
  assert.throws(() => normalizeReactionEmoji("<:other:456789012345678901>", guild), /does not belong/);
  assert.throws(() => normalizeReactionEmoji("not-an-emoji", guild), /not a valid emoji/);
});
