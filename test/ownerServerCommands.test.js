const test = require("node:test");
const assert = require("node:assert/strict");
const { Collection } = require("discord.js");

require("module-alias/register");
const leaveServerCommand = require("../src/commands/owner/leaveserver");
const listServersCommand = require("../src/commands/owner/listservers");

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
