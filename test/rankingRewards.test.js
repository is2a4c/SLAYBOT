const test = require("node:test");
const assert = require("node:assert/strict");
require("module-alias/register");

const { applyRoleRewards, crossedRewards } = require("../src/services/stats/RoleRewards");
const {
  RankingError,
  addReward,
  createReward,
  parseMemberStats,
  removeReward,
} = require("../dashboard/services/ranking");

const ROLE_A = "100000000000000001";
const ROLE_B = "100000000000000002";

function guild() {
  return {
    id: "100000000000000000",
    roles: {
      cache: new Map([
        [ROLE_A, { id: ROLE_A, managed: false, editable: true }],
        [ROLE_B, { id: ROLE_B, managed: false, editable: true }],
      ]),
    },
  };
}

test("ranking rewards trigger only when their threshold is crossed", () => {
  const rewards = [{ threshold: 2 }, { threshold: 5 }, { threshold: 9 }];
  assert.deepEqual(
    crossedRewards(rewards, 1, 5).map((reward) => reward.threshold),
    [2, 5]
  );
  assert.deepEqual(crossedRewards(rewards, 5, 5), []);
  assert.deepEqual(crossedRewards(rewards, 9, 5), []);
});

test("crossed rewards remove roles first and add roles once", async () => {
  const calls = [];
  const member = {
    guild: guild(),
    roles: {
      remove: async (ids) => calls.push(["remove", ids]),
      add: async (ids) => calls.push(["add", ids]),
    },
  };
  const result = await applyRoleRewards(
    member,
    [
      { threshold: 2, add_roles: [ROLE_A], remove_roles: [ROLE_B] },
      { threshold: 3, add_roles: [ROLE_A], remove_roles: [] },
    ],
    1,
    3
  );
  assert.deepEqual(calls, [
    ["remove", [ROLE_B]],
    ["add", [ROLE_A]],
  ]);
  assert.equal(result.crossed, 2);
});

test("dashboard reward input validates thresholds, roles, and duplicates", () => {
  const { type, reward } = createReward(guild(), {
    type: "VOICE",
    threshold: "30",
    addRoles: [ROLE_A, ROLE_A],
    removeRoles: [ROLE_A, ROLE_B],
  });
  assert.equal(type, "voice");
  assert.equal(reward.threshold, 1800);
  assert.deepEqual(reward.add_roles, [ROLE_A]);
  assert.deepEqual(reward.remove_roles, [ROLE_B]);
  assert.throws(() => addReward([{ threshold: 1800 }], reward), RankingError);
  assert.deepEqual(removeReward([reward], reward.id), []);
});

test("member ranking edits are bounded", () => {
  assert.deepEqual(parseMemberStats({ level: "7", xp: "25", voiceMinutes: "90" }), {
    level: 7,
    xp: 25,
    voiceSeconds: 5400,
  });
  assert.throws(() => parseMemberStats({ level: "0", xp: "25", voiceMinutes: "90" }), /Level/);
});
