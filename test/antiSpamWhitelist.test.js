const test = require("node:test");
const assert = require("node:assert/strict");

require("module-alias/register");

const memberSchema = require("../src/database/schemas/Member");
const modUtils = require("../src/helpers/ModUtils");
const automodLogs = require("../src/database/schemas/AutomodLogs");

memberSchema.getMember = async () => ({
  strikes: 0,
  save: async () => {},
});
modUtils.addModAction = async () => {};
automodLogs.addAutoModLogToDb = async () => {};

delete require.cache[require.resolve("../src/handlers/automod")];
const { performAutomod, isAntiSpamWhitelisted, antispamCache } = require("../src/handlers/automod");
const antiCommand = require("../src/commands/admin/automod/anti");

const USER_ID = "123456789012345678";
const OTHER_USER_ID = "234567890123456789";
const ROLE_ID = "345678901234567890";
const GUILD_ID = "456789012345678901";

test.beforeEach(() => antispamCache.clear());

test("ordinary repeated messages still trigger antispam", async () => {
  const settings = createAutomodSettings();
  const message = createMessage();

  assert.equal((await performAutomod(message, settings)).triggered, false);
  assert.equal((await performAutomod(message, settings)).triggered, true);
});

test("a whitelisted user does not trigger repeated-message antispam", async () => {
  const settings = createAutomodSettings({ spam_whitelist_users: [USER_ID] });
  const message = createMessage();

  assert.equal((await performAutomod(message, settings)).triggered, false);
  assert.equal((await performAutomod(message, settings)).triggered, false);
  assert.equal(antispamCache.size, 0);
});

test("a member with a whitelisted role does not trigger repeated-message antispam", async () => {
  const settings = createAutomodSettings({ spam_whitelist_roles: [ROLE_ID] });
  const message = createMessage({ roleIds: [ROLE_ID] });

  assert.equal((await performAutomod(message, settings)).triggered, false);
  assert.equal((await performAutomod(message, settings)).triggered, false);
});

test("antispam whitelist does not bypass Anti Links", async () => {
  const settings = createAutomodSettings({
    spam_whitelist_users: [USER_ID],
    anti_links: true,
  });
  const result = await performAutomod(createMessage({ content: "visit https://example.com" }), settings);

  assert.equal(result.triggered, true);
  assert.equal(result.deleted, true);
});

test("antispam whitelist does not bypass mass mention detection", async () => {
  const settings = createAutomodSettings({
    spam_whitelist_users: [USER_ID],
    anti_massmention: 1,
  });
  const result = await performAutomod(createMessage({ userMentionCount: 2 }), settings);

  assert.equal(result.triggered, true);
  assert.equal(result.deleted, false);
});

test("whitelist checks tolerate a message without a guild member", () => {
  const message = { author: { id: USER_ID } };

  assert.equal(isAntiSpamWhitelisted(message, { spam_whitelist_roles: [ROLE_ID] }), false);
});

test("whitelist checks tolerate legacy automod settings without new fields", () => {
  const message = createMessage({ roleIds: [ROLE_ID] });

  assert.equal(isAntiSpamWhitelisted(message, {}), false);
});

test("duplicate additions are rejected and do not create another ID", async () => {
  const settings = createSettingsDocument({
    spam_whitelist_users: [USER_ID, USER_ID],
  });
  const response = await antiCommand.addWhitelistEntry(settings, "users", USER_ID);

  assert.match(response, /already/);
  assert.deepEqual(settings.automod.spam_whitelist_users, [USER_ID]);
  assert.equal(settings.saveCalls, 0);
});

test("removing a missing ID returns a clear response", async () => {
  const settings = createSettingsDocument();
  const response = await antiCommand.removeWhitelistEntry(settings, "users", OTHER_USER_ID);

  assert.match(response, /is not in/);
  assert.equal(settings.saveCalls, 0);
});

test("clearing users preserves role whitelist entries", async () => {
  const settings = createSettingsDocument({
    spam_whitelist_users: [USER_ID],
    spam_whitelist_roles: [ROLE_ID],
  });

  await antiCommand.clearWhitelist(settings, "users");

  assert.deepEqual(settings.automod.spam_whitelist_users, []);
  assert.deepEqual(settings.automod.spam_whitelist_roles, [ROLE_ID]);
});

test("clearing roles preserves user whitelist entries", async () => {
  const settings = createSettingsDocument({
    spam_whitelist_users: [USER_ID],
    spam_whitelist_roles: [ROLE_ID],
  });

  await antiCommand.clearWhitelist(settings, "roles");

  assert.deepEqual(settings.automod.spam_whitelist_users, [USER_ID]);
  assert.deepEqual(settings.automod.spam_whitelist_roles, []);
});

test("clearing all removes both whitelist arrays", async () => {
  const settings = createSettingsDocument({
    spam_whitelist_users: [USER_ID],
    spam_whitelist_roles: [ROLE_ID],
  });

  await antiCommand.clearWhitelist(settings, "ALL");

  assert.deepEqual(settings.automod.spam_whitelist_users, []);
  assert.deepEqual(settings.automod.spam_whitelist_roles, []);
});

test("@everyone cannot be added to the role whitelist", async () => {
  const settings = createSettingsDocument();
  const response = await antiCommand.addWhitelistEntry(settings, "roles", GUILD_ID, {
    guild: { id: GUILD_ID, roles: { cache: new Map() } },
  });

  assert.match(response, /@everyone/);
  assert.deepEqual(settings.automod.spam_whitelist_roles, []);
});

test("managed integration roles cannot be added to the role whitelist", async () => {
  const settings = createSettingsDocument();
  const role = { id: ROLE_ID, managed: true };
  const response = await antiCommand.addWhitelistEntry(settings, "roles", ROLE_ID, {
    guild: { id: GUILD_ID, roles: { cache: new Map([[ROLE_ID, role]]) } },
    role,
  });

  assert.match(response, /Managed integration/);
  assert.deepEqual(settings.automod.spam_whitelist_roles, []);
});

test("anti command retains ManageGuild permission and ephemeral slash replies", () => {
  assert.deepEqual(antiCommand.userPermissions, ["ManageGuild"]);
  assert.equal(antiCommand.slashCommand.ephemeral, true);
});

test("whitelist formatting labels unknown entries and stays below Discord's limit", () => {
  const userIds = Array.from({ length: 80 }, (_, index) => String(100000000000000000n + BigInt(index)));
  const output = antiCommand.formatWhitelist(
    { spam_whitelist_users: userIds, spam_whitelist_roles: [ROLE_ID] },
    { members: { cache: new Map() }, roles: { cache: new Map([[ROLE_ID, {}]]) } }
  );

  assert.match(output, /Unknown User/);
  assert.match(output, new RegExp(`<@&${ROLE_ID}>`));
  assert.match(output, /more entr/);
  assert.ok(output.length <= 1950);
});

function createSettingsDocument(automod = {}) {
  const settings = {
    automod: { ...automod },
    saveCalls: 0,
    async save() {
      this.saveCalls += 1;
    },
  };
  return settings;
}

function createAutomodSettings(overrides = {}) {
  return {
    modlog_channel: null,
    automod: {
      debug: false,
      wh_channels: [],
      anti_attachments: false,
      anti_invites: false,
      anti_links: false,
      anti_spam: true,
      anti_image_spam: false,
      anti_ghostping: false,
      anti_massmention: 0,
      max_lines: 0,
      max_mentions: 5,
      max_role_mentions: 3,
      strikes: 10,
      action: "TIMEOUT",
      ...overrides,
    },
  };
}

function createMessage({ content = "same message", roleIds = [], userMentionCount = 0 } = {}) {
  const me = { id: "bot" };
  const member = {
    permissions: { has: () => false },
    roles: {
      cache: {
        some: (predicate) => roleIds.some((id) => predicate({ id })),
      },
    },
  };
  const guild = {
    id: GUILD_ID,
    name: "Test Guild",
    iconURL: () => null,
    members: { me },
    client: { logger: { error: () => {} } },
  };
  const channel = {
    guild,
    permissionsFor: (target) => ({ has: () => target === me }),
    toString: () => "#general",
    safeSend: () => {},
  };

  return {
    id: "message",
    guildId: GUILD_ID,
    channelId: "channel",
    content,
    member,
    guild,
    channel,
    author: {
      id: USER_ID,
      username: "User",
      displayAvatarURL: () => null,
      avatarURL: () => null,
      send: async () => {},
    },
    mentions: {
      members: { size: userMentionCount },
      users: { size: userMentionCount },
      roles: { size: 0 },
      everyone: false,
    },
    attachments: new Map(),
    deletable: true,
    delete: async () => {},
    client: { logger: { debug: () => {}, warn: () => {} } },
  };
}
