const test = require("node:test");
const assert = require("node:assert/strict");
const { Collection } = require("discord.js");

require("module-alias/register");
const leaveServerCommand = require("../src/commands/owner/leaveserver");
const listServersCommand = require("../src/commands/owner/listservers");
const blockServerCommand = require("../src/commands/owner/blockserver");
const blockedServerService = require("../src/services/blockedServers");

const SERVER_ID = "456789012345678901";

test("owner server commands are registered as ephemeral slash commands", () => {
  assert.equal(leaveServerCommand.category, "OWNER");
  assert.equal(leaveServerCommand.slashCommand.enabled, true);
  assert.equal(leaveServerCommand.slashCommand.ephemeral, true);
  assert.equal(leaveServerCommand.slashCommand.options[0].name, "server-id");

  assert.equal(listServersCommand.category, "OWNER");
  assert.equal(listServersCommand.slashCommand.enabled, true);
  assert.equal(listServersCommand.slashCommand.ephemeral, true);
  assert.equal(listServersCommand.slashCommand.options[0].name, "match");

  assert.equal(blockServerCommand.category, "OWNER");
  assert.equal(blockServerCommand.slashCommand.enabled, true);
  assert.equal(blockServerCommand.slashCommand.ephemeral, true);
  assert.deepEqual(
    blockServerCommand.slashCommand.options.map((option) => option.name),
    ["block", "unblock", "list", "status"]
  );
});

test("server block duration supports temporary and permanent blocks", () => {
  assert.deepEqual(blockServerCommand.parseDuration("1h"), {
    duration: 60 * 60 * 1000,
    isPermanent: false,
  });
  assert.deepEqual(blockServerCommand.parseDuration("forever"), {
    duration: 0,
    isPermanent: true,
  });
  assert.equal(blockServerCommand.parseDuration("invalid"), null);
});

test("blocking a server persists the block and makes the bot leave immediately", async () => {
  let created;
  let leaveCalls = 0;
  const model = {
    findOne: async () => null,
    create: async (record) => {
      created = record;
    },
  };
  const client = {
    config: { EMBED_COLORS: { ERROR: 0xff0000 } },
    guilds: {
      cache: new Collection([
        [
          SERVER_ID,
          {
            id: SERVER_ID,
            name: "Blocked Guild",
            leave: async () => {
              leaveCalls += 1;
            },
          },
        ],
      ]),
    },
    logger: { error: () => assert.fail("unexpected leave error") },
  };

  const response = await blockServerCommand.executeAction({
    action: "block",
    serverId: SERVER_ID,
    durationInput: "1h",
    reason: "abuse",
    user: { id: "678901234567890123" },
    client,
    model,
  });

  assert.equal(created.serverId, SERVER_ID);
  assert.equal(created.reason, "abuse");
  assert.equal(created.isPermanent, false);
  assert.equal(leaveCalls, 1);
  assert.equal(response.embeds.length, 1);
});

test("unblocking a server removes the persisted block", async () => {
  let deletedServerId;
  const model = {
    deleteOne: async (query) => {
      deletedServerId = query.serverId;
      return { deletedCount: 1 };
    },
  };
  const response = await blockServerCommand.executeAction({
    action: "unblock",
    serverId: SERVER_ID,
    user: { id: "678901234567890123" },
    client: {},
    model,
  });

  assert.equal(deletedServerId, SERVER_ID);
  assert.match(response, /разблокирован/);
});

test("guild create rejects an actively blocked server before registration", async () => {
  const originalGetActiveBlock = blockedServerService.getActiveBlock;
  blockedServerService.getActiveBlock = async () => ({ serverId: SERVER_ID });
  delete require.cache[require.resolve("../src/events/guild/guildCreate")];
  const guildCreate = require("../src/events/guild/guildCreate");

  let leaveCalls = 0;
  const client = {
    logger: {
      warn: () => {},
      error: () => assert.fail("unexpected blocked guild leave error"),
    },
  };
  const guild = {
    id: SERVER_ID,
    name: "Blocked Guild",
    available: true,
    leave: async () => {
      leaveCalls += 1;
    },
  };

  try {
    await guildCreate(client, guild);
    assert.equal(leaveCalls, 1);
  } finally {
    blockedServerService.getActiveBlock = originalGetActiveBlock;
    delete require.cache[require.resolve("../src/events/guild/guildCreate")];
  }
});

test("leave server owner command leaves the selected cached guild", async () => {
  let leaveCalls = 0;
  const client = {
    guilds: {
      cache: new Collection([
        [
          SERVER_ID,
          {
            id: SERVER_ID,
            name: "Selected Guild",
            leave: async () => {
              leaveCalls += 1;
            },
          },
        ],
      ]),
    },
    logger: { error: () => assert.fail("unexpected leave error") },
  };

  const response = await leaveServerCommand.leaveServer(client, SERVER_ID);

  assert.equal(leaveCalls, 1);
  assert.match(response, /Successfully left/);
  assert.match(response, new RegExp(SERVER_ID));
});

test("leave server owner command rejects invalid and unknown IDs", async () => {
  const client = {
    guilds: { cache: new Collection() },
    logger: { error: () => {} },
  };

  assert.match(await leaveServerCommand.leaveServer(client, "not-an-id"), /valid server ID/);
  assert.match(await leaveServerCommand.leaveServer(client, SERVER_ID), /No server found/);
});

test("server listing matches exact IDs and partial names without duplicates", () => {
  const alpha = { id: SERVER_ID, name: "Alpha Community" };
  const beta = { id: "567890123456789012", name: "Beta Community" };
  const client = {
    guilds: {
      cache: new Collection([
        [alpha.id, alpha],
        [beta.id, beta],
      ]),
    },
  };

  assert.deepEqual(listServersCommand.selectServers(client, SERVER_ID), [alpha]);
  assert.deepEqual(listServersCommand.selectServers(client, "community"), [alpha, beta]);
  assert.deepEqual(listServersCommand.selectServers(client, null), [alpha, beta]);
});

test("server listing renders through the slash-compatible message collector path", async () => {
  const guild = {
    id: SERVER_ID,
    name: "Alpha Community",
    ownerId: "678901234567890123",
    memberCount: 2,
    createdTimestamp: 1_700_000_000_000,
    members: {
      cache: new Collection([
        ["member", { user: { bot: false } }],
        ["bot", { user: { bot: true } }],
      ]),
    },
  };
  const client = {
    config: { EMBED_COLORS: { BOT_EMBED: 0x5865f2 } },
    guilds: { cache: new Collection([[guild.id, guild]]) },
    users: { cache: new Collection() },
  };
  const collectorHandlers = {};
  const sentMessage = {
    createMessageComponentCollector: () => ({
      on: (event, handler) => {
        collectorHandlers[event] = handler;
      },
    }),
    edit: async () => {},
  };
  let payload;

  await listServersCommand.sendServerList({
    client,
    userId: "789012345678901234",
    match: null,
    settingsLoader: async () => ({ data: { inviteUrl: "https://discord.gg/test" } }),
    send: async (response) => {
      payload = response;
      return sentMessage;
    },
  });

  assert.equal(payload.embeds.length, 1);
  assert.match(payload.embeds[0].data.description, /Alpha Community/);
  assert.match(payload.embeds[0].data.description, /discord\.gg\/test/);
  assert.equal(payload.components.length, 1);
  assert.equal(typeof collectorHandlers.collect, "function");
  assert.equal(typeof collectorHandlers.end, "function");
});
