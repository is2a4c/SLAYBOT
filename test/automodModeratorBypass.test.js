const test = require("node:test");
const assert = require("node:assert/strict");
require("module-alias/register");

const memberSchema = require("../src/database/schemas/Member");

memberSchema.getMember = async () => ({ strikes: 0, save: async () => {} });

delete require.cache[require.resolve("../src/handlers/automod")];
const { performAutomod, antispamCache } = require("../src/handlers/automod");

const GUILD_ID = "100000000000000001";
const ROLE_ID = "200000000000000001";
const OTHER_ROLE_ID = "200000000000000002";

test.beforeEach(() => antispamCache.clear());

function createMessage({ roleIds = [] } = {}) {
  const me = { id: "bot" };
  const held = new Set(roleIds);
  const member = {
    permissions: { has: () => false },
    roles: {
      cache: {
        has: (id) => held.has(id),
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
    content: "visit https://example.com",
    member,
    guild,
    channel,
    author: {
      id: "author",
      bot: false,
      username: "author",
      displayAvatarURL: () => null,
      avatarURL: () => null,
      send: async () => {},
    },
    mentions: { members: { size: 0 }, users: { size: 0 }, roles: { size: 0 }, everyone: false },
    attachments: new Map(),
    deletable: true,
    delete: async () => {},
    client: { logger: { debug: () => {}, warn: () => {} } },
  };
}

function settingsWith(moderatorRoleIds = []) {
  return {
    modlog_channel: null,
    control_center: { moderation: { moderator_roles: moderatorRoleIds } },
    automod: {
      debug: false,
      wh_channels: [],
      anti_links: true,
      anti_spam: false,
      anti_image_spam: false,
    },
  };
}

test("a plain member still gets caught by automod", async () => {
  const result = await performAutomod(createMessage(), settingsWith());
  assert.equal(result.triggered, true);
});

test("a member holding a listed moderator role is exempt, same as a Discord-permission moderator", async () => {
  const settings = settingsWith([ROLE_ID]);
  const result = await performAutomod(createMessage({ roleIds: [ROLE_ID] }), settings);
  assert.equal(result.triggered, false);
});

test("holding an unrelated role does not exempt anyone", async () => {
  const settings = settingsWith([ROLE_ID]);
  const result = await performAutomod(createMessage({ roleIds: [OTHER_ROLE_ID] }), settings);
  assert.equal(result.triggered, true);
});

test("debug mode still inspects a moderator's own messages", async () => {
  const settings = { ...settingsWith([ROLE_ID]), automod: { ...settingsWith([ROLE_ID]).automod, debug: true } };
  const result = await performAutomod(createMessage({ roleIds: [ROLE_ID] }), settings);
  assert.equal(result.triggered, true, "debug mode inspects everyone, moderator bypass or not");
});
