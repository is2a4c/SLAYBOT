require("module-alias/register");

const test = require("node:test");
const assert = require("node:assert/strict");
const { Collection, PermissionsBitField } = require("discord.js");

const { runDiagnostics, REQUIRED_BOT_PERMISSIONS } = require("../src/services/dashboard/diagnostics");

const GUILD_ID = "100000000000000001";
const MODLOG_CHANNEL_ID = "200000000000000001";

function baseGuild({
  botPermissions = REQUIRED_BOT_PERMISSIONS,
  botRolePosition = 10,
  roles = [],
  channels = [],
} = {}) {
  const roleCache = new Collection();
  roleCache.set(GUILD_ID, { id: GUILD_ID, managed: false, position: 0 }); // @everyone
  for (const role of roles) roleCache.set(role.id, role);

  const channelCache = new Collection();
  for (const channel of channels) channelCache.set(channel.id, channel);

  return {
    id: GUILD_ID,
    members: {
      me: {
        permissions: new PermissionsBitField(botPermissions.map((p) => PermissionsBitField.Flags[p])),
        roles: { highest: { position: botRolePosition } },
      },
    },
    roles: { cache: roleCache },
    channels: { cache: channelCache },
  };
}

function baseSettings(overrides = {}) {
  return {
    modlog_channel: null,
    ticket: {},
    automod: { wh_channels: [] },
    autorole: [],
    welcome: { enabled: false },
    farewell: { enabled: false },
    suggestions: { enabled: false },
    ...overrides,
  };
}

test("a fully healthy guild reports only pass checks", () => {
  const guild = baseGuild({ channels: [{ id: MODLOG_CHANNEL_ID, name: "mod-log" }] });
  const settings = baseSettings({ modlog_channel: MODLOG_CHANNEL_ID });

  const { checks, summary } = runDiagnostics(guild, settings);

  assert.equal(summary.failed, 0);
  assert.equal(summary.warned, 0);
  assert.ok(checks.find((c) => c.id === "bot_permissions").status === "pass");
  assert.ok(checks.find((c) => c.id === "modlog_channel").status === "pass");
});

test("missing bot permissions are reported as a failure listing what's missing", () => {
  const guild = baseGuild({ botPermissions: ["ViewChannel", "SendMessages"] });
  const { checks } = runDiagnostics(guild, baseSettings());

  const permCheck = checks.find((c) => c.id === "bot_permissions");
  assert.equal(permCheck.status, "fail");
  assert.match(permCheck.message, /ManageMessages/);
});

test("roles above the bot's own role produce a warning with the count", () => {
  const guild = baseGuild({
    botRolePosition: 1,
    roles: [
      { id: "300000000000000001", managed: false, position: 2 },
      { id: "300000000000000002", managed: false, position: 3 },
      { id: "300000000000000003", managed: true, position: 5 }, // managed (e.g. bot integration) roles don't count
    ],
  });
  const { checks } = runDiagnostics(guild, baseSettings());

  const roleCheck = checks.find((c) => c.id === "role_position");
  assert.equal(roleCheck.status, "warn");
  assert.match(roleCheck.message, /2 роль/);
});

test("a configured modlog channel that no longer exists fails", () => {
  const guild = baseGuild();
  const settings = baseSettings({ modlog_channel: "999999999999999999" });
  const { checks } = runDiagnostics(guild, settings);
  assert.equal(checks.find((c) => c.id === "modlog_channel").status, "fail");
});

test("an active Smart Invite pointing at a deleted channel fails, passed via extra.smartInvites", () => {
  const guild = baseGuild();
  const { checks } = runDiagnostics(guild, baseSettings(), {
    smartInvites: [{ status: "active", channelId: "999999999999999999" }],
  });
  assert.equal(checks.find((c) => c.id === "smart_invites").status, "fail");
});

test("no guild member (me) short-circuits with a single failing check", () => {
  const guild = { id: GUILD_ID, members: { me: null } };
  const { checks, summary } = runDiagnostics(guild, baseSettings());
  assert.equal(checks.length, 1);
  assert.equal(checks[0].status, "fail");
  assert.equal(summary.failed, 1);
});
