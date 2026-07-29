const test = require("node:test");
const assert = require("node:assert/strict");

require("module-alias/register");

const shardResume = require("../src/events/shardResume");

test("shard resume immediately restores configured presence", async () => {
  const updates = [];
  const logs = [];
  const client = {
    config: {
      PRESENCE: {
        enabled: true,
        TYPE: "PLAYING",
        STATUS: "idle",
        MESSAGE: ["{servers} servers | {members} members"],
      },
    },
    guilds: {
      cache: {
        size: 2,
        map: (callback) => [{ memberCount: 3 }, { memberCount: 4 }].map(callback),
      },
    },
    user: {
      setPresence: (presence) => updates.push(presence),
    },
    logger: {
      log: (message) => logs.push(message),
    },
  };

  await shardResume(client, 0, 12);

  assert.deepEqual(updates, [
    {
      status: "idle",
      activities: [{ name: "2 servers | 7 members", type: 0 }],
    },
  ]);
  assert.match(logs[0], /presence restored/);
});
