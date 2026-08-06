const test = require("node:test");
const assert = require("node:assert/strict");
require("module-alias/register");

// The handler takes getSettings at load time, so the stand-in has to be in place
// before it is loaded — otherwise the tests reach for a database that is not there.
let current = null;
const guildPath = require.resolve("@schemas/Guild");
require.cache[guildPath] = {
  id: guildPath,
  filename: guildPath,
  loaded: true,
  exports: { getSettings: async () => current },
};

const { checkInviteRewards } = require("@src/handlers/invite");

/**
 * Rewards handed out for invites.
 *
 * A server deletes roles, and a reward pointing at one of them can never be
 * given again — so the interesting part is not the giving, it is what happens
 * the second time.
 */

const GUILD_ID = "900000000000000009";
const MEMBER_ID = "100000000000000001";

/**
 * @param {{roles?: string[], ranks: object[], fail?: object}} input
 */
function makeWorld({ roles = [], ranks, fail = null }) {
  const given = [];
  const taken = [];
  const logged = [];
  const held = new Set();

  const member = {
    id: MEMBER_ID,
    roles: {
      cache: { has: (id) => held.has(id) },
      add: async (id) => {
        if (fail) throw fail;
        given.push(id);
        held.add(id);
      },
      remove: async (id) => {
        if (fail) throw fail;
        taken.push(id);
        held.delete(id);
      },
    },
  };

  const guild = {
    id: GUILD_ID,
    members: { fetch: async () => member },
    roles: { cache: { has: (id) => roles.includes(id) } },
    client: { logger: { debug: (line) => logged.push(line), log: (line) => logged.push(line) } },
  };

  const settings = { saves: 0, invite: { ranks }, save: async () => (settings.saves += 1) };

  return { guild, member, settings, given, taken, logged, held };
}

/**
 * The inviter's numbers, as the tracker keeps them.
 */
const inviterData = (tracked) => ({
  member_id: MEMBER_ID,
  invite_data: { tracked, added: 0, fake: 0, left: 0 },
});

/**
 * @param {object} settings
 * @param {() => Promise<void>} work
 */
async function withSettings(settings, work) {
  current = settings;
  try {
    await work();
  } finally {
    current = null;
  }
}

test("a reward is given once the invites are there", async () => {
  const world = makeWorld({ roles: ["777"], ranks: [{ _id: "777", invites: 3 }] });

  await withSettings(world.settings, () => checkInviteRewards(world.guild, inviterData(3), true));

  assert.deepEqual(world.given, ["777"]);
  assert.equal(world.settings.invite.ranks.length, 1, "the reward stays for the next inviter");
});

test("a reward whose role the server deleted is dropped instead of asked for again", async () => {
  const world = makeWorld({ roles: [], ranks: [{ _id: "777", invites: 3 }] });

  await withSettings(world.settings, () => checkInviteRewards(world.guild, inviterData(5), true));

  assert.deepEqual(world.given, [], "there is nothing to give");
  assert.deepEqual(world.settings.invite.ranks, [], "and nothing left to try again");
  assert.equal(world.settings.saves, 1);
});

test("a role Discord says is unknown is dropped as well", async () => {
  const world = makeWorld({
    roles: ["777"],
    ranks: [{ _id: "777", invites: 1 }],
    fail: Object.assign(new Error("Unknown Role"), { code: 10011 }),
  });

  await withSettings(world.settings, () => checkInviteRewards(world.guild, inviterData(2), true));

  assert.deepEqual(world.settings.invite.ranks, []);
});

test("a refusal that is not about the role leaves the reward alone", async () => {
  const world = makeWorld({
    roles: ["777"],
    ranks: [{ _id: "777", invites: 1 }],
    fail: Object.assign(new Error("Missing Permissions"), { code: 50013 }),
  });

  await withSettings(world.settings, () => checkInviteRewards(world.guild, inviterData(2), true));

  assert.equal(world.settings.invite.ranks.length, 1, "the role is there, the bot simply may not hand it out");
  assert.equal(world.settings.saves, 0);
  assert.match(world.logged.join("\n"), /Missing Permissions/);
});

test("losing invites takes the reward back", async () => {
  const world = makeWorld({ roles: ["777"], ranks: [{ _id: "777", invites: 5 }] });
  world.held.add("777");

  await withSettings(world.settings, () => checkInviteRewards(world.guild, inviterData(2), false));

  assert.deepEqual(world.taken, ["777"]);
});
