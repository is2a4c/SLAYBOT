const test = require("node:test");
const assert = require("node:assert/strict");
require("module-alias/register");

const memberRoles = require("../src/handlers/memberRoles");

const GUILD = "999999999999999999";
const NEWCOMER = "111111111111111111";
const MEMBER_ROLE = "222222222222222222";
const VERIFIED_ROLE = "333333333333333333";
const STAFF_ROLE = "444444444444444444";
const BOOSTER_ROLE = "555555555555555555";

const role = (id, position, extra = {}) => ({ id, position, managed: false, ...extra });

/**
 * @param {{roles: object[], botHighest?: number, canManageRoles?: boolean}} input
 */
function fakeMember({ roles, botHighest = 10, canManageRoles = true }) {
  const given = [];

  return {
    given,
    id: NEWCOMER,
    client: { logger: { error: () => {} } },
    guild: {
      id: GUILD,
      roles: { cache: new Map(roles.map((entry) => [entry.id, entry])) },
      members: {
        me: {
          roles: { highest: { position: botHighest } },
          permissions: { has: () => canManageRoles },
        },
      },
    },
    roles: {
      add: async (ids) => {
        given.push(...(Array.isArray(ids) ? ids : [ids]));
      },
    },
  };
}

/* ------------------------------------------------------------- stored shape */

test("autoroles are read as a list, whatever they were stored as", () => {
  assert.deepEqual(memberRoles.normalizeAutoRoles([MEMBER_ROLE, VERIFIED_ROLE]), [MEMBER_ROLE, VERIFIED_ROLE]);
  // Installs configured before autoroles became a list kept a single id.
  assert.deepEqual(memberRoles.normalizeAutoRoles(MEMBER_ROLE), [MEMBER_ROLE]);
  assert.deepEqual(memberRoles.normalizeAutoRoles([]), []);
  assert.deepEqual(memberRoles.normalizeAutoRoles(null), []);
  assert.deepEqual(memberRoles.normalizeAutoRoles(undefined), []);
  assert.deepEqual(memberRoles.normalizeAutoRoles([MEMBER_ROLE, null, ""]), [MEMBER_ROLE]);
});

/* ------------------------------------------------------------- handing out */

test("every configured role is given in one go", async () => {
  const member = fakeMember({ roles: [role(MEMBER_ROLE, 2), role(VERIFIED_ROLE, 3)] });

  const given = await memberRoles.applyAutoRoles(member, { autorole: [MEMBER_ROLE, VERIFIED_ROLE] });

  assert.deepEqual(given, [MEMBER_ROLE, VERIFIED_ROLE]);
  assert.deepEqual(member.given, [MEMBER_ROLE, VERIFIED_ROLE]);
});

test("a single stored role still reaches the newcomer", async () => {
  const member = fakeMember({ roles: [role(MEMBER_ROLE, 2)] });

  assert.deepEqual(await memberRoles.applyAutoRoles(member, { autorole: MEMBER_ROLE }), [MEMBER_ROLE]);
});

test("roles the bot cannot give are skipped, the rest still land", async () => {
  const member = fakeMember({
    roles: [
      role(MEMBER_ROLE, 2),
      role(STAFF_ROLE, 20), // above the bot
      role(BOOSTER_ROLE, 4, { managed: true }), // owned by an integration
      role(GUILD, 0), // @everyone shares the guild id
    ],
  });

  const given = await memberRoles.applyAutoRoles(member, {
    autorole: [MEMBER_ROLE, STAFF_ROLE, BOOSTER_ROLE, GUILD, "666666666666666666"],
  });

  assert.deepEqual(given, [MEMBER_ROLE], "deleted, managed, too-high and @everyone are all refused");
});

test("nothing is attempted without the permission or without configuration", async () => {
  const noPermission = fakeMember({ roles: [role(MEMBER_ROLE, 2)], canManageRoles: false });
  assert.deepEqual(await memberRoles.applyAutoRoles(noPermission, { autorole: [MEMBER_ROLE] }), []);
  assert.deepEqual(noPermission.given, []);

  const unconfigured = fakeMember({ roles: [role(MEMBER_ROLE, 2)] });
  assert.deepEqual(await memberRoles.applyAutoRoles(unconfigured, { autorole: [] }), []);
  assert.deepEqual(await memberRoles.applyAutoRoles(unconfigured, {}), []);
  assert.deepEqual(unconfigured.given, []);
});

test("a failure to add roles is reported as nothing given", async () => {
  const member = fakeMember({ roles: [role(MEMBER_ROLE, 2)] });
  member.roles.add = async () => {
    throw new Error("Missing Permissions");
  };

  assert.deepEqual(await memberRoles.applyAutoRoles(member, { autorole: [MEMBER_ROLE] }), []);
});
