const test = require("node:test");
const assert = require("node:assert/strict");
require("module-alias/register");

const memberRoles = require("../src/handlers/memberRoles");
const { MAX_AUTOROLES, mergeAutoRoles, removeAutoRoles } = require("../src/handlers/autorole");

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

/* ---------------------------------------------------------- picking several */

test("picking several roles adds them all to what is already there", () => {
  const result = mergeAutoRoles({ current: [MEMBER_ROLE], picked: [VERIFIED_ROLE, BOOSTER_ROLE] });

  assert.deepEqual(result.next, [MEMBER_ROLE, VERIFIED_ROLE, BOOSTER_ROLE], "the existing role survives");
  assert.deepEqual(result.added, [VERIFIED_ROLE, BOOSTER_ROLE]);
});

test("re-picking a role already on the list changes nothing", () => {
  const result = mergeAutoRoles({ current: [MEMBER_ROLE], picked: [MEMBER_ROLE, VERIFIED_ROLE] });

  assert.deepEqual(result.next, [MEMBER_ROLE, VERIFIED_ROLE]);
  assert.deepEqual(result.added, [VERIFIED_ROLE]);
  assert.deepEqual(result.already, [MEMBER_ROLE]);
});

test("roles the bot cannot hand out are reported back, the rest are kept", () => {
  const result = mergeAutoRoles({
    current: [],
    picked: [MEMBER_ROLE, STAFF_ROLE],
    giveable: (id) => id !== STAFF_ROLE,
  });

  assert.deepEqual(result.next, [MEMBER_ROLE]);
  assert.deepEqual(result.refused, [STAFF_ROLE]);
});

test("the cap holds and names what did not fit", () => {
  const current = Array.from({ length: MAX_AUTOROLES }, (_, index) => `role-${index}`);

  const result = mergeAutoRoles({ current, picked: [MEMBER_ROLE] });

  assert.equal(result.next.length, MAX_AUTOROLES);
  assert.deepEqual(result.overflow, [MEMBER_ROLE]);
  assert.deepEqual(result.added, []);
});

test("a single stored role can still be added to", () => {
  const result = mergeAutoRoles({ current: MEMBER_ROLE, picked: [VERIFIED_ROLE] });

  assert.deepEqual(result.next, [MEMBER_ROLE, VERIFIED_ROLE]);
});

/* -------------------------------------------------------- removing several */

test("removing takes out exactly what was picked", () => {
  const result = removeAutoRoles({
    current: [MEMBER_ROLE, VERIFIED_ROLE, BOOSTER_ROLE],
    picked: [MEMBER_ROLE, BOOSTER_ROLE],
  });

  assert.deepEqual(result.next, [VERIFIED_ROLE], "removal does not disable the rest");
  assert.deepEqual(result.removed, [MEMBER_ROLE, BOOSTER_ROLE]);
});

test("removing a role that is not configured leaves the list alone", () => {
  const result = removeAutoRoles({ current: [MEMBER_ROLE], picked: [STAFF_ROLE] });

  assert.deepEqual(result.next, [MEMBER_ROLE]);
  assert.deepEqual(result.removed, []);
  assert.deepEqual(result.missing, [STAFF_ROLE]);
});

test("removing the last role empties the list rather than leaving a stray", () => {
  const result = removeAutoRoles({ current: [MEMBER_ROLE], picked: [MEMBER_ROLE] });

  assert.deepEqual(result.next, []);
});
