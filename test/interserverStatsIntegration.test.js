const test = require("node:test");
const assert = require("node:assert/strict");

require("module-alias/register");

const memberStatsSchema = require("../src/database/schemas/MemberStats");
const originalGetMemberStats = memberStatsSchema.getMemberStats;

function loadStatsHandler(statsDocument) {
  memberStatsSchema.getMemberStats = async () => statsDocument;
  delete require.cache[require.resolve("../src/handlers/stats")];
  return require("../src/handlers/stats");
}

function createStatsDocument() {
  return {
    commands: { prefix: 0, slash: 0 },
    contexts: { user: 0, message: 0 },
    messages: 0,
    xp: 0,
    level: 1,
    saveCalls: 0,
    async save() {
      this.saveCalls += 1;
    },
  };
}

function createMessage(id) {
  const warnings = [];
  return {
    message: {
      id,
      guildId: "guild-1",
      createdAt: new Date("2026-07-29T12:00:00.000Z"),
      member: {
        id: "user-1",
        guild: {
          id: "guild-1",
          name: "Guild",
          memberCount: 1,
          channels: { cache: new Map() },
        },
        displayName: "User",
        user: { username: "User" },
        toString: () => "<@user-1>",
      },
      channel: { safeSend: () => {} },
      client: {
        config: {
          STATS: {
            XP_COOLDOWN: 60,
            DEFAULT_LVL_UP_MSG: "{member:name} reached {level}",
          },
        },
        logger: {
          warn: (warning) => warnings.push(warning),
        },
      },
    },
    warnings,
  };
}

test("AC-3: skipped XP messages never reach the interserver ecosystem", async () => {
  const stats = createStatsDocument();
  const handler = loadStatsHandler(stats);
  const { message } = createMessage("skip-message");
  let ecosystemCalls = 0;

  await handler.trackMessageStats(
    message,
    false,
    {},
    {
      skipXp: true,
      ecosystemService: {
        recordActivity: async () => {
          ecosystemCalls += 1;
        },
      },
    }
  );

  assert.equal(stats.messages, 1);
  assert.equal(stats.xp, 0);
  assert.equal(stats.saveCalls, 1);
  assert.equal(ecosystemCalls, 0);
});

test("AC-8: ecosystem storage failure is logged after local XP is saved and does not escape", async () => {
  const stats = createStatsDocument();
  const handler = loadStatsHandler(stats);
  const { message, warnings } = createMessage("failure-message");
  let savedBeforeEcosystem = false;

  await assert.doesNotReject(
    handler.trackMessageStats(
      message,
      false,
      {},
      {
        ecosystemService: {
          recordActivity: async () => {
            savedBeforeEcosystem = stats.saveCalls === 1;
            throw new Error("mongo unavailable");
          },
        },
      }
    )
  );

  assert.equal(savedBeforeEcosystem, true);
  assert.equal(stats.saveCalls, 1);
  assert.ok(stats.xp >= 1 && stats.xp <= 20);
  assert.match(warnings[0], /mongo unavailable/);
});

test.after(() => {
  memberStatsSchema.getMemberStats = originalGetMemberStats;
  delete require.cache[require.resolve("../src/handlers/stats")];
});
