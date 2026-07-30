const test = require("node:test");
const assert = require("node:assert/strict");
require("module-alias/register");

const { resolveVoiceRoleChanges, managedRoles } = require("../src/handlers/voiceRoles");
const memberRoles = require("../src/handlers/memberRoles");
const { collectRestorableRoles } = require("../src/database/schemas/MemberRoles");
const { assertDuration, TempRoleError } = require("../src/services/roles/TempRoles");

const IN_VOICE = "111111111111111111";
const GAMING = "222222222222222222";
const MUSIC = "333333333333333333";
const VOICE_CHANNEL = "444444444444444444";
const OTHER_CHANNEL = "555555555555555555";

const voiceSettings = (overrides = {}) => ({
  voice_roles: {
    enabled: true,
    default_role: IN_VOICE,
    channels: [
      { channel_id: VOICE_CHANNEL, role_id: GAMING },
      { channel_id: OTHER_CHANNEL, role_id: MUSIC },
    ],
    ...overrides,
  },
});

test("joining a channel grants the channel role and the any-channel role", () => {
  const { add, remove } = resolveVoiceRoleChanges({
    settings: voiceSettings(),
    memberRoleIds: [],
    channelId: VOICE_CHANNEL,
  });

  assert.deepEqual(add.sort(), [IN_VOICE, GAMING].sort());
  assert.deepEqual(remove, []);
});

test("moving between channels swaps only the channel-specific role", () => {
  const { add, remove } = resolveVoiceRoleChanges({
    settings: voiceSettings(),
    memberRoleIds: [IN_VOICE, GAMING],
    channelId: OTHER_CHANNEL,
  });

  assert.deepEqual(add, [MUSIC]);
  assert.deepEqual(remove, [GAMING]);
});

test("leaving voice removes every managed role but leaves other roles alone", () => {
  const unrelated = "666666666666666666";
  const { add, remove } = resolveVoiceRoleChanges({
    settings: voiceSettings(),
    memberRoleIds: [IN_VOICE, GAMING, unrelated],
    channelId: null,
  });

  assert.deepEqual(add, []);
  assert.deepEqual(remove.sort(), [IN_VOICE, GAMING].sort());
  assert.ok(!remove.includes(unrelated));
});

test("a disabled configuration is a no-op", () => {
  const settings = voiceSettings();
  settings.voice_roles.enabled = false;

  assert.deepEqual(resolveVoiceRoleChanges({ settings, memberRoleIds: [IN_VOICE], channelId: VOICE_CHANNEL }), {
    add: [],
    remove: [],
  });
  assert.deepEqual(managedRoles(settings), []);
});

/* ------------------------------------------------------------ restore roles */

function fakeMember({ roles, botHighest = 10 }) {
  const guild = {
    id: "999999999999999999",
    members: { me: { roles: { highest: { position: botHighest } }, permissions: { has: () => true } } },
    roles: { cache: new Map(roles.map((role) => [role.id, role])) },
  };
  const cache = new Map(roles.map((role) => [role.id, role]));
  cache.filter = (fn) => [...cache.values()].filter(fn);
  return {
    id: "888888888888888888",
    user: { bot: false },
    guild,
    roles: { cache },
  };
}

const role = (id, position, extra = {}) => ({
  id,
  position,
  managed: false,
  permissions: { has: () => false },
  ...extra,
});

test("snapshots skip @everyone, managed roles and roles above the bot", () => {
  const member = fakeMember({
    roles: [
      role("999999999999999999", 0), // @everyone shares the guild id
      role(GAMING, 5),
      role(MUSIC, 20), // above the bot
      role(IN_VOICE, 3, { managed: true }),
    ],
  });

  assert.deepEqual(collectRestorableRoles(member), [GAMING]);
});

test("restore skips privileged roles unless the guild opted in", () => {
  const admin = role(MUSIC, 4, { permissions: { has: (perm) => perm === "ManageGuild" } });
  const plain = role(GAMING, 5);
  const tooHigh = role(IN_VOICE, 30);
  const guild = {
    id: "999999999999999999",
    members: { me: { roles: { highest: { position: 10 } }, permissions: { has: () => true } } },
    roles: {
      cache: new Map([
        [admin.id, admin],
        [plain.id, plain],
        [tooHigh.id, tooHigh],
      ]),
    },
  };

  const snapshot = [admin.id, plain.id, tooHigh.id, "777777777777777777"];

  assert.deepEqual(memberRoles.filterRestorable(guild, snapshot), [plain.id]);
  assert.deepEqual(
    memberRoles.filterRestorable(guild, snapshot, { includePrivileged: true }).sort(),
    [admin.id, plain.id].sort()
  );
});

test("restore is skipped entirely when disabled", async () => {
  const restored = await memberRoles.restoreRoles({ user: { bot: false } }, { restore_roles: { enabled: false } });
  assert.deepEqual(restored, []);
});

/* --------------------------------------------------------------- temp roles */

test("temporary role durations are bounded", () => {
  assert.equal(assertDuration(60_000), 60_000);
  assert.throws(() => assertDuration(null), TempRoleError);
  assert.throws(() => assertDuration(500), /at least 10 seconds/);
  assert.throws(() => assertDuration(400 * 24 * 60 * 60 * 1000), /cannot exceed one year/);
});
