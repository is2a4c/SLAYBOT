const test = require("node:test");
const assert = require("node:assert/strict");
require("module-alias/register");

const {
  DEFAULT_WARNING_EXPIRY_DAYS,
  blockReactionsEnabled,
  cooldownExemptEnabled,
  isCooldownExemptModerator,
  isModerator,
  isMuted,
  moderatorRoleIds,
  muteExcludedChannelIds,
  muteMode,
  muteRoleId,
  muteScope,
  respectsRoleHierarchy,
  scopeCoversText,
  scopeCoversVoice,
  usesRoleMute,
  usesTimeoutMute,
  warningExpiryDays,
} = require("@src/services/moderation/policy");

const ROLE_ID = "100000000000000001";
const OTHER_ROLE_ID = "100000000000000002";
const CHANNEL_ID = "200000000000000001";

function settingsWith(moderation) {
  return { control_center: { moderation } };
}

function member(...roleIds) {
  const held = new Set(roleIds);
  return { roles: { cache: { has: (id) => held.has(id) } } };
}

/* ------------------------------------------------------------- moderator team */

test("moderatorRoleIds and isModerator read the server's own list, empty by default", () => {
  assert.deepEqual(moderatorRoleIds(null), []);
  assert.deepEqual(moderatorRoleIds(settingsWith({})), []);
  assert.equal(isModerator(settingsWith({}), member(ROLE_ID)), false, "no roles listed means nobody qualifies");

  const settings = settingsWith({ moderator_roles: [ROLE_ID] });
  assert.equal(isModerator(settings, member(ROLE_ID)), true);
  assert.equal(isModerator(settings, member(OTHER_ROLE_ID)), false);
  assert.equal(isModerator(settings, null), false);
});

test("cooldownExemptEnabled defaults to on, matching the schema default", () => {
  assert.equal(cooldownExemptEnabled(settingsWith({})), true);
  assert.equal(cooldownExemptEnabled(settingsWith({ cooldown_exempt: false })), false);
  assert.equal(cooldownExemptEnabled(settingsWith({ cooldown_exempt: true })), true);
});

test("isCooldownExemptModerator needs the role, the switch on, and an actual member", () => {
  const settings = settingsWith({ moderator_roles: [ROLE_ID] });
  assert.equal(isCooldownExemptModerator(settings, member(ROLE_ID)), true);
  assert.equal(isCooldownExemptModerator(settings, member(OTHER_ROLE_ID)), false, "does not hold the role");
  assert.equal(isCooldownExemptModerator(settings, null), false, "no member to check");
  assert.equal(
    isCooldownExemptModerator(settingsWith({ moderator_roles: [ROLE_ID], cooldown_exempt: false }), member(ROLE_ID)),
    false,
    "the server turned the exemption off"
  );
});

/* --------------------------------------------------------------- hierarchy */

test("respectsRoleHierarchy defaults to on, matching the schema default", () => {
  assert.equal(respectsRoleHierarchy(null), true);
  assert.equal(respectsRoleHierarchy(settingsWith({})), true);
  assert.equal(respectsRoleHierarchy(settingsWith({ respect_role_hierarchy: false })), false);
  assert.equal(respectsRoleHierarchy(settingsWith({ respect_role_hierarchy: true })), true);
});

/* ---------------------------------------------------------------- warnings */

test("warningExpiryDays falls back to the schema default on garbage, but 0 is a real value", () => {
  assert.equal(warningExpiryDays(null), DEFAULT_WARNING_EXPIRY_DAYS);
  assert.equal(warningExpiryDays(settingsWith({})), DEFAULT_WARNING_EXPIRY_DAYS);
  assert.equal(warningExpiryDays(settingsWith({ warning_expiry_days: 0 })), 0, "0 means never expire, not unset");
  assert.equal(warningExpiryDays(settingsWith({ warning_expiry_days: 90 })), 90);
  assert.equal(warningExpiryDays(settingsWith({ warning_expiry_days: -5 })), DEFAULT_WARNING_EXPIRY_DAYS);
});

/* -------------------------------------------------------------------- mute */

test("muteMode and muteScope default sensibly and reject unknown values", () => {
  assert.equal(muteMode(null), "TIMEOUT");
  assert.equal(muteMode(settingsWith({ mute_mode: "ROLE" })), "ROLE");
  assert.equal(muteMode(settingsWith({ mute_mode: "BOTH" })), "BOTH");
  assert.equal(muteMode(settingsWith({ mute_mode: "NONSENSE" })), "TIMEOUT");

  assert.equal(muteScope(null), "ALL");
  assert.equal(muteScope(settingsWith({ default_mute_scope: "TEXT" })), "TEXT");
  assert.equal(muteScope(settingsWith({ default_mute_scope: "VOICE" })), "VOICE");
  assert.equal(muteScope(settingsWith({ default_mute_scope: "NONSENSE" })), "ALL");
});

test("usesRoleMute and usesTimeoutMute reflect the mode correctly for all three settings", () => {
  assert.deepEqual(
    [usesRoleMute(settingsWith({ mute_mode: "TIMEOUT" })), usesTimeoutMute(settingsWith({ mute_mode: "TIMEOUT" }))],
    [false, true]
  );
  assert.deepEqual(
    [usesRoleMute(settingsWith({ mute_mode: "ROLE" })), usesTimeoutMute(settingsWith({ mute_mode: "ROLE" }))],
    [true, false]
  );
  assert.deepEqual(
    [usesRoleMute(settingsWith({ mute_mode: "BOTH" })), usesTimeoutMute(settingsWith({ mute_mode: "BOTH" }))],
    [true, true]
  );
});

test("scopeCoversText and scopeCoversVoice split ALL into both", () => {
  assert.deepEqual(
    [
      scopeCoversText(settingsWith({ default_mute_scope: "ALL" })),
      scopeCoversVoice(settingsWith({ default_mute_scope: "ALL" })),
    ],
    [true, true]
  );
  assert.deepEqual(
    [
      scopeCoversText(settingsWith({ default_mute_scope: "TEXT" })),
      scopeCoversVoice(settingsWith({ default_mute_scope: "TEXT" })),
    ],
    [true, false]
  );
  assert.deepEqual(
    [
      scopeCoversText(settingsWith({ default_mute_scope: "VOICE" })),
      scopeCoversVoice(settingsWith({ default_mute_scope: "VOICE" })),
    ],
    [false, true]
  );
});

test("muteRoleId and muteExcludedChannelIds are null/empty until the server sets them", () => {
  assert.equal(muteRoleId(settingsWith({})), null);
  assert.equal(muteRoleId(settingsWith({ mute_role: ROLE_ID })), ROLE_ID);
  assert.deepEqual(muteExcludedChannelIds(settingsWith({})), []);
  assert.deepEqual(muteExcludedChannelIds(settingsWith({ mute_excluded_channels: [CHANNEL_ID] })), [CHANNEL_ID]);
});

test("blockReactionsEnabled is off by default, matching the schema default", () => {
  assert.equal(blockReactionsEnabled(settingsWith({})), false);
  assert.equal(blockReactionsEnabled(settingsWith({ block_reactions: true })), true);
});

/* ------------------------------------------------------------------ isMuted */

test("isMuted checks the role under ROLE/BOTH and Discord's own timeout under TIMEOUT/BOTH", () => {
  const roleSettings = settingsWith({ mute_mode: "ROLE", mute_role: ROLE_ID });
  assert.equal(isMuted(member(ROLE_ID), roleSettings), true);
  assert.equal(isMuted(member(OTHER_ROLE_ID), roleSettings), false);

  const timeoutSettings = settingsWith({ mute_mode: "TIMEOUT" });
  const timedOut = { communicationDisabledUntilTimestamp: Date.now() + 60_000, roles: { cache: { has: () => false } } };
  const notTimedOut = {
    communicationDisabledUntilTimestamp: Date.now() - 60_000,
    roles: { cache: { has: () => false } },
  };
  assert.equal(isMuted(timedOut, timeoutSettings), true);
  assert.equal(isMuted(notTimedOut, timeoutSettings), false);

  // TIMEOUT-only mode ignores a held role entirely.
  assert.equal(isMuted(member(ROLE_ID), timeoutSettings), false);

  const bothSettings = settingsWith({ mute_mode: "BOTH", mute_role: ROLE_ID });
  const roleOnly = { ...member(ROLE_ID), communicationDisabledUntilTimestamp: 0 };
  assert.equal(isMuted(roleOnly, bothSettings), true, "either mechanism is enough under BOTH");

  assert.equal(isMuted(null, roleSettings), false);
});
