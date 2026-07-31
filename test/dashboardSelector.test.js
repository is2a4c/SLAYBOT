const test = require("node:test");
const assert = require("node:assert/strict");
require("module-alias/register");

const { buildSelectorGuilds } = require("../dashboard/routes/selector");

function clientWithGuilds(ids) {
  return {
    guilds: { cache: new Map(ids.map((id) => [id, { id }])) },
    getInvite: () => "https://discord.com/oauth2/authorize?client_id=test",
  };
}

test("selector never adds bot guilds absent from the logged-in user's OAuth guild list", () => {
  const client = clientWithGuilds(["shared", "bot-only"]);
  const guilds = buildSelectorGuilds({
    client,
    oauthGuilds: [{ id: "shared", name: "Shared", icon: null, owner: true, permissions: "0" }],
  });

  assert.deepEqual(
    guilds.map((guild) => guild.id),
    ["shared"]
  );
});

test("selector includes only OAuth guilds the user can manage", () => {
  const client = clientWithGuilds(["owned", "managed", "member-only"]);
  const guilds = buildSelectorGuilds({
    client,
    oauthGuilds: [
      { id: "member-only", name: "Member only", icon: null, owner: false, permissions: "0" },
      { id: "managed", name: "Managed", icon: null, owner: false, permissions: "32" },
      { id: "owned", name: "Owned", icon: null, owner: true, permissions: "0" },
      { id: "broken", name: "Broken", icon: null, owner: false, permissions: "not-a-number" },
    ],
  });

  assert.deepEqual(
    guilds.map((guild) => guild.id),
    ["managed", "owned"]
  );
});

test("selector marks manageable OAuth guilds without the bot as invite targets", () => {
  const client = clientWithGuilds([]);
  const [guild] = buildSelectorGuilds({
    client,
    oauthGuilds: [{ id: "invite-me", name: "Invite me", icon: null, owner: true, permissions: "0" }],
  });

  assert.equal(guild.botPresent, false);
  assert.match(guild.inviteUrl, /guild_id=invite-me/);
});
