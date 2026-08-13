const test = require("node:test");
const assert = require("node:assert/strict");
require("module-alias/register");

const { buildGreeting } = require("../src/handlers/greeting");

function member() {
  return {
    displayName: "Ann",
    displayAvatarURL: () => "https://cdn/avatar.png",
    toString: () => "<@1>",
    guild: { name: "Slay", memberCount: 10 },
    user: {
      bot: false,
      username: "ann",
      discriminator: "0",
      globalName: "Ann",
      displayAvatarURL: () => "https://cdn/avatar.png",
    },
  };
}

test("greetings expose title, author and timestamp templates", async () => {
  const payload = await buildGreeting(member(), "WELCOME", {
    content: null,
    embed: {
      title: "Welcome {member:name}",
      author: "{server}",
      description: null,
      color: null,
      thumbnail: false,
      footer: null,
      image: null,
      timestamp: true,
    },
  });

  const embed = payload.embeds[0].data;
  assert.equal(embed.title, "Welcome ann");
  assert.equal(embed.author.name, "Slay");
  assert.ok(embed.timestamp);
});
