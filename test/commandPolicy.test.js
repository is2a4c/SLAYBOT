const test = require("node:test");
const assert = require("node:assert/strict");
require("module-alias/register");

const {
  categoryDisabled,
  commandPolicy,
  effectiveCooldown,
  isDefaultPolicy,
  policyProblem,
  sanitizeCommandPolicy,
  sanitizeDisabledCategories,
  upsertCommandPolicy,
} = require("@src/services/commands/policy");
const catalog = require("@src/services/commands/catalog");
const { buildCommandCatalog } = require("../dashboard/services/commandCatalog");

const STAFF_ROLE = "100000000000000007";
const OTHER_ROLE = "100000000000000008";
const CHANNEL = "200000000000000001";
const OTHER_CHANNEL = "200000000000000002";
const CATEGORY = "300000000000000001";

const BAN = { name: "ban", description: "bans somebody", category: "MODERATION", cooldown: 10 };

function member(...roleIds) {
  const held = new Set(roleIds);
  return { id: "1", roles: { cache: { has: (id) => held.has(id) } } };
}

function settingsWith(policy = {}, common = {}) {
  return {
    control_center: { common: { text_commands: true, slash_commands: true, ...common } },
    command_policy: { disabled_categories: [], commands: [], ...policy },
  };
}

/* ------------------------------------------------------------------ reading */

test("a server that changed nothing refuses nothing", () => {
  const settings = settingsWith();
  assert.equal(commandPolicy(settings, "ban"), null);
  assert.equal(categoryDisabled(settings, "MODERATION"), false);
  assert.equal(policyProblem(settings, BAN, { member: member(), channelId: CHANNEL, source: "slash" }), null);
  assert.equal(effectiveCooldown(settings, BAN), 10);
});

test("a disabled command is refused, whichever way it was invoked", () => {
  const settings = settingsWith({ commands: [{ name: "ban", enabled: false }] });

  for (const source of ["prefix", "slash", "panel"]) {
    const problem = policyProblem(settings, BAN, { member: member(), channelId: CHANNEL, source });
    assert.match(problem, /disabled on this server/, `${source} still ran a disabled command`);
  }
});

test("a disabled category takes its commands with it", () => {
  const settings = settingsWith({ disabled_categories: ["MODERATION"] });
  assert.match(policyProblem(settings, BAN, { source: "slash" }), /group is disabled/);
  assert.equal(policyProblem(settings, { name: "avatar", category: "INFORMATION" }, { source: "slash" }), null);
});

test("the global switches only reach the kind of invocation they name", () => {
  const noText = settingsWith({}, { text_commands: false });
  assert.match(policyProblem(noText, BAN, { source: "prefix" }), /Text commands are disabled/);
  assert.equal(policyProblem(noText, BAN, { source: "slash" }), null);

  const noSlash = settingsWith({}, { slash_commands: false });
  assert.match(policyProblem(noSlash, BAN, { source: "slash" }), /Slash commands are disabled/);
  assert.equal(policyProblem(noSlash, BAN, { source: "prefix" }), null);
});

test("an allow-list of roles refuses everybody outside it", () => {
  const settings = settingsWith({ commands: [{ name: "ban", enabled: true, allowed_roles: [STAFF_ROLE] }] });

  assert.equal(policyProblem(settings, BAN, { member: member(STAFF_ROLE), source: "slash" }), null);
  assert.match(policyProblem(settings, BAN, { member: member(OTHER_ROLE), source: "slash" }), /role allowed/);
  // No member means nothing proves the role, so the allow-list cannot be met.
  assert.match(policyProblem(settings, BAN, { source: "slash" }), /role allowed/);
});

test("an allow-list of channels accepts the channel itself or its category", () => {
  const settings = settingsWith({ commands: [{ name: "ban", enabled: true, allowed_channels: [CHANNEL, CATEGORY] }] });
  const ask = (channelId, parentId) =>
    policyProblem(settings, BAN, { member: member(), channelId, parentId, source: "slash" });

  assert.equal(ask(CHANNEL), null);
  assert.equal(ask(OTHER_CHANNEL, CATEGORY), null, "a channel inside an allowed category is allowed");
  assert.match(ask(OTHER_CHANNEL, null), /not available in this channel/);
});

test("a cooldown override wins, and zero really means none", () => {
  assert.equal(effectiveCooldown(settingsWith({ commands: [{ name: "ban", cooldown_seconds: 60 }] }), BAN), 60);
  assert.equal(effectiveCooldown(settingsWith({ commands: [{ name: "ban", cooldown_seconds: 0 }] }), BAN), 0);
  assert.equal(effectiveCooldown(settingsWith({ commands: [{ name: "ban", cooldown_seconds: null }] }), BAN), 10);
  assert.equal(effectiveCooldown(null, BAN), 10);
});

test("a member holding a listed moderator role skips cooldowns entirely, before any override is even read", () => {
  const settings = {
    ...settingsWith({ commands: [{ name: "ban", cooldown_seconds: 60 }] }),
    control_center: {
      common: { text_commands: true, slash_commands: true },
      moderation: { moderator_roles: [STAFF_ROLE] },
    },
  };

  assert.equal(effectiveCooldown(settings, BAN, member(STAFF_ROLE)), 0);
  assert.equal(effectiveCooldown(settings, BAN, member(OTHER_ROLE)), 60, "an unrelated role still waits");
  assert.equal(effectiveCooldown(settings, BAN), 60, "no member to check means no exemption");
});

test("a server can turn the moderator cooldown exemption off without removing the role list", () => {
  const settings = {
    control_center: {
      common: { text_commands: true, slash_commands: true },
      moderation: { moderator_roles: [STAFF_ROLE], cooldown_exempt: false },
    },
  };

  assert.equal(effectiveCooldown(settings, BAN, member(STAFF_ROLE)), 10, "the exemption itself is off");
});

/* ------------------------------------------------------- no way around this */

test("the policy never grants what Discord's permissions refuse", () => {
  // A command nobody may run stays unrunnable however generous the policy is.
  const settings = settingsWith({
    commands: [{ name: "ban", enabled: true, allowed_roles: [], allowed_channels: [] }],
  });
  const barred = { id: "1", permissions: { has: () => false }, roles: { cache: { has: () => true } } };

  assert.equal(
    catalog.allowed({ ...BAN, userPermissions: ["BanMembers"], slashCommand: { enabled: true } }, barred, settings),
    false
  );
});

test("the catalogue leaves out what the server switched off", () => {
  const command = { ...BAN, userPermissions: [], slashCommand: { enabled: true }, command: { enabled: true } };
  const anyone = { id: "1", permissions: { has: () => true }, roles: { cache: { has: () => true } } };

  assert.equal(catalog.allowed(command, anyone, settingsWith()), true);
  assert.equal(catalog.allowed(command, anyone, settingsWith({ commands: [{ name: "ban", enabled: false }] })), false);
  assert.equal(catalog.allowed(command, anyone, settingsWith({ disabled_categories: ["MODERATION"] })), false);
});

/* ------------------------------------------------------------------ writing */

test("a submitted policy keeps only ids the server actually has", () => {
  const clean = sanitizeCommandPolicy(
    {
      name: "  BAN  ",
      enabled: true,
      cooldown_seconds: "45",
      allowed_roles: [STAFF_ROLE, "not-a-snowflake", OTHER_ROLE, STAFF_ROLE],
      allowed_channels: [CHANNEL, OTHER_CHANNEL],
    },
    { roleExists: (id) => id === STAFF_ROLE, channelExists: (id) => id === CHANNEL }
  );

  assert.deepEqual(clean, {
    name: "ban",
    enabled: true,
    cooldown_seconds: 45,
    allowed_roles: [STAFF_ROLE],
    allowed_channels: [CHANNEL],
  });
});

test("a cooldown outside what the schema takes is clamped, not stored", () => {
  const at = (value) => sanitizeCommandPolicy({ name: "ban", cooldown_seconds: value }).cooldown_seconds;
  assert.equal(at("999999999"), 86400);
  assert.equal(at("-5"), 0);
  assert.equal(at(""), null);
  assert.equal(at("abc"), null);
  assert.equal(sanitizeCommandPolicy({ name: "   " }), null);
});

test("a policy that says nothing new is dropped instead of stored", () => {
  const defaults = sanitizeCommandPolicy({ name: "ban", enabled: true });
  assert.equal(isDefaultPolicy(defaults), true);

  const stored = upsertCommandPolicy([{ name: "ban", enabled: false }], defaults);
  assert.deepEqual(stored, []);
});

test("upsert replaces one command and leaves the rest in name order", () => {
  const current = [
    { name: "kick", enabled: false, cooldown_seconds: null, allowed_roles: [], allowed_channels: [] },
    { name: "ban", enabled: false, cooldown_seconds: null, allowed_roles: [], allowed_channels: [] },
  ];
  const next = sanitizeCommandPolicy({ name: "ban", enabled: true, cooldown_seconds: "30" });
  const stored = upsertCommandPolicy(current, next);

  assert.deepEqual(
    stored.map((entry) => entry.name),
    ["ban", "kick"]
  );
  assert.equal(stored.find((entry) => entry.name === "ban").cooldown_seconds, 30);
  assert.equal(stored.find((entry) => entry.name === "kick").enabled, false);
});

test("only categories the bot really has can be switched off", () => {
  assert.deepEqual(sanitizeDisabledCategories(["moderation", "NOPE", "FUN", "FUN"], ["MODERATION", "FUN"]), [
    "FUN",
    "MODERATION",
  ]);
  assert.deepEqual(sanitizeDisabledCategories("MODERATION", ["MODERATION"]), ["MODERATION"]);
  assert.deepEqual(sanitizeDisabledCategories([], ["MODERATION"]), []);
});

/* ---------------------------------------------------------------- dashboard */

test("the dashboard catalogue reports the policy next to the permissions", () => {
  const command = {
    name: "ban",
    description: "bans somebody",
    category: "MODERATION",
    cooldown: 10,
    userPermissions: ["BanMembers"],
    botPermissions: [],
    slashCommand: { enabled: true, options: [] },
    command: { enabled: true, usage: "<member>" },
  };

  const guild = { members: { me: { permissions: { has: () => true } } } };
  const settings = settingsWith({
    disabled_categories: ["FUN"],
    commands: [{ name: "ban", enabled: true, cooldown_seconds: 60, allowed_roles: [STAFF_ROLE], allowed_channels: [] }],
  });

  const catalogue = buildCommandCatalog({
    client: { commands: [command], slashCommands: new Map([["ban", command]]) },
    guild,
    member: { permissions: { has: () => true } },
    isOwner: false,
    prefix: "!",
    settings,
  });

  const entry = catalogue.commands.find((item) => item.name === "ban");
  assert.equal(entry.ready, true, "Discord readiness is reported separately from the policy");
  assert.equal(entry.policy.enabled, true);
  assert.equal(entry.policy.effectiveCooldown, 60);
  assert.deepEqual(entry.policy.allowedRoles, [STAFF_ROLE]);
  assert.equal(entry.policy.restricted, true);
  assert.equal(catalogue.summary.restricted, 1);
  assert.deepEqual(
    catalogue.categories.map((category) => category.id),
    ["MODERATION"]
  );
});
