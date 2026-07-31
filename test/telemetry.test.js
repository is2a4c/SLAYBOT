const test = require("node:test");
const assert = require("node:assert/strict");

require("module-alias/register");

const { PermissionFlagsBits } = require("discord.js");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const { TelemetryService } = require("../src/services/telemetry/TelemetryService");
const telemetryCommand = require("../src/commands/stats/telemetry");

const NOW = new Date("2026-07-29T12:00:00.000Z");
const GUILD_ID = "456789012345678901";
const USER_ID = "567890123456789012";

function createModels({ docs = [], actors = [] } = {}) {
  const writes = { buckets: [], actors: [] };
  const bucketModel = {
    bulkWrite: async (operations) => writes.buckets.push(...operations),
    find: () => ({
      lean: async () => docs,
    }),
  };
  const actorModel = {
    bulkWrite: async (operations) => writes.actors.push(...operations),
    aggregate: async () => actors,
  };
  return { bucketModel, actorModel, writes };
}

test("telemetry batches global and guild aggregates without storing raw actor IDs", async () => {
  const { bucketModel, actorModel, writes } = createModels();
  const service = new TelemetryService({
    config: { enabled: true, retentionDays: 30 },
    bucketModel,
    actorModel,
    hashSecret: "test-secret",
    now: () => NOW,
    logger: { warn: () => {} },
  });

  service.record("messages", { guildId: GUILD_ID, userId: USER_ID });
  service.recordCommand({
    guildId: GUILD_ID,
    userId: USER_ID,
    commandName: "Ping",
    source: "prefix",
    success: true,
    durationMs: 42,
  });
  service.recordAutomod({ guildId: GUILD_ID, userId: USER_ID, deleted: true, strikes: 2 });
  await service.flush();

  assert.equal(writes.buckets.length, 2);
  assert.equal(writes.actors.length, 2);

  const globalUpdate = writes.buckets.find((operation) => operation.updateOne.filter._id.includes(":global:")).updateOne
    .update;
  const guildUpdate = writes.buckets.find((operation) => operation.updateOne.filter._id.includes(`:guild:${GUILD_ID}`))
    .updateOne.update;

  for (const update of [globalUpdate, guildUpdate]) {
    assert.equal(update.$inc["counters.messages"], 1);
    assert.equal(update.$inc["counters.commands"], 1);
    assert.equal(update.$inc["counters.command_successes"], 1);
    assert.equal(update.$inc["counters.prefix_commands"], 1);
    assert.equal(update.$inc["counters.automod_actions"], 1);
    assert.equal(update.$inc["counters.automod_deletions"], 1);
    assert.equal(update.$inc["counters.automod_strikes"], 2);
    assert.equal(update.$inc["command_usage.ping"], 1);
    assert.equal(update.$inc["command_latency.total_ms"], 42);
    assert.equal(update.$max["command_latency.max_ms"], 42);
  }

  const serializedActors = JSON.stringify(writes.actors);
  assert.doesNotMatch(serializedActors, new RegExp(USER_ID));
  assert.match(serializedActors, /actor_hash/);
});

test("telemetry summary combines daily buckets, command usage, and unique actors", async () => {
  const { bucketModel, actorModel } = createModels({
    docs: [
      {
        counters: { messages: 10, commands: 2, command_successes: 1 },
        command_usage: { ping: 2 },
        command_latency: { total_ms: 60, samples: 2, max_ms: 40 },
      },
      {
        counters: { messages: 5, commands: 1, command_successes: 1 },
        command_usage: { ping: 1, help: 1 },
        command_latency: { total_ms: 30, samples: 1, max_ms: 30 },
      },
    ],
    actors: [{ count: 4 }],
  });
  const service = new TelemetryService({
    bucketModel,
    actorModel,
    hashSecret: "test-secret",
    now: () => NOW,
  });

  const summary = await service.getSummary({
    scope: "guild",
    guildId: GUILD_ID,
    periodDays: 7,
  });

  assert.equal(summary.counters.messages, 15);
  assert.equal(summary.counters.commands, 3);
  assert.equal(summary.counters.command_successes, 2);
  assert.deepEqual(summary.commandUsage, { ping: 3, help: 1 });
  assert.equal(summary.commandLatency.averageMs, 30);
  assert.equal(summary.commandLatency.maxMs, 40);
  assert.equal(summary.activeUsers, 4);
});

test("failed telemetry writes are restored for a later flush", async () => {
  let attempts = 0;
  const bucketModel = {
    bulkWrite: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("temporary database failure");
    },
    find: () => ({ lean: async () => [] }),
  };
  const actorModel = {
    bulkWrite: async () => {},
    aggregate: async () => [],
  };
  const service = new TelemetryService({
    bucketModel,
    actorModel,
    hashSecret: null,
    now: () => NOW,
  });

  service.record("messages", { guildId: GUILD_ID });
  await assert.rejects(service.flush(), /temporary database failure/);
  assert.equal(service.bucketBuffer.size, 2);
  await service.flush();
  assert.equal(attempts, 2);
  assert.equal(service.bucketBuffer.size, 0);
});

test("server admins cannot request global telemetry", () => {
  const member = {
    permissions: {
      has: (permission) => permission === PermissionFlagsBits.ManageGuild,
    },
  };

  assert.deepEqual(
    telemetryCommand.resolveAccess({
      member,
      userId: USER_ID,
      requestedScope: "server",
    }),
    { scope: "server", isOwner: false }
  );
  assert.match(
    telemetryCommand.resolveAccess({
      member,
      userId: USER_ID,
      requestedScope: "global",
    }).error,
    /только owner/
  );
  assert.match(
    telemetryCommand.resolveAccess({
      member: { permissions: { has: () => false } },
      userId: USER_ID,
      requestedScope: "server",
    }).error,
    /администраторам/
  );
});

test("telemetry command requests only the invoking guild for an admin", async () => {
  let requested;
  const client = {
    telemetry: {
      getSummary: async (input) => {
        requested = input;
        return {
          periodDays: 7,
          scope: "guild",
          guildId: GUILD_ID,
          counters: {
            messages: 0,
            interactions: 0,
            commands: 0,
            command_successes: 0,
            command_failures: 0,
            slash_commands: 0,
            prefix_commands: 0,
            context_commands: 0,
            button_interactions: 0,
            modal_interactions: 0,
            automod_actions: 0,
            automod_deletions: 0,
            automod_strikes: 0,
            member_joins: 0,
            member_leaves: 0,
            guild_joins: 0,
            guild_leaves: 0,
            voice_joins: 0,
            voice_leaves: 0,
            voice_seconds: 0,
            client_errors: 0,
            client_warnings: 0,
          },
          commandUsage: {},
          commandLatency: { averageMs: 0, maxMs: 0 },
          activeUsers: 0,
        };
      },
    },
    ws: { ping: 12 },
    guilds: { cache: { size: 3 } },
  };
  const guild = { id: GUILD_ID, name: "Telemetry Guild" };
  const member = { permissions: { has: () => true } };

  const payload = await telemetryCommand.buildTelemetryReport({
    client,
    guild,
    member,
    userId: USER_ID,
    requestedScope: "server",
    period: 7,
  });

  assert.deepEqual(requested, {
    scope: "guild",
    guildId: GUILD_ID,
    periodDays: 7,
  });
  assert.equal(payload.embeds.length, 1);
  assert.match(payload.embeds[0].data.title, /Telemetry Guild/);
});

test("MongoDB integration persists and reads private guild telemetry", async () => {
  const mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  const bucketModel = require("../src/database/schemas/TelemetryBucket");
  const actorModel = require("../src/database/schemas/TelemetryActor");

  try {
    const service = new TelemetryService({
      bucketModel,
      actorModel,
      hashSecret: "integration-secret",
      now: () => NOW,
    });
    service.record("messages", { guildId: GUILD_ID, userId: USER_ID });
    service.recordCommand({
      guildId: GUILD_ID,
      userId: USER_ID,
      commandName: "telemetry",
      source: "slash",
      success: true,
      durationMs: 25,
    });
    await service.flush();

    const summary = await service.getSummary({
      scope: "guild",
      guildId: GUILD_ID,
      periodDays: 7,
    });
    assert.equal(summary.counters.messages, 1);
    assert.equal(summary.counters.commands, 1);
    assert.equal(summary.commandUsage.telemetry, 1);
    assert.equal(summary.activeUsers, 1);
    assert.equal(await bucketModel.countDocuments({ scope: "global" }), 1);
    assert.equal(await bucketModel.countDocuments({ scope: "guild", guild_id: GUILD_ID }), 1);
  } finally {
    await mongoose.disconnect();
    await mongo.stop();
  }
});
