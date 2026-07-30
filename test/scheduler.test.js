const test = require("node:test");
const assert = require("node:assert/strict");
require("module-alias/register");

const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const { Scheduler } = require("../src/services/scheduler/Scheduler");
const scheduledTask = require("../src/database/schemas/ScheduledTask");

const GUILD_ID = "456789012345678901";
let mongo;

test.before(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await scheduledTask.model.syncIndexes();
});

test.after(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

test.beforeEach(async () => {
  await scheduledTask.model.deleteMany({});
});

test("due tasks run once and are then removed", async () => {
  const scheduler = new Scheduler({ client: { logger: { error: () => {} } } });
  const seen = [];
  scheduler.register("PING", async (payload) => seen.push(payload.value));

  await scheduler.schedule({ type: "PING", guildId: GUILD_ID, runAt: Date.now() - 1000, payload: { value: "a" } });
  await scheduler.schedule({
    type: "PING",
    guildId: GUILD_ID,
    runAt: Date.now() + 60_000,
    payload: { value: "later" },
  });

  const first = await scheduler.tick();
  assert.deepEqual(seen, ["a"]);
  assert.equal(first.processed, 1);

  const second = await scheduler.tick();
  assert.equal(second.processed, 0, "a completed task must not run twice");
  assert.equal(await scheduledTask.model.countDocuments({}), 1, "the future task is still pending");
});

test("a task missed while offline still runs on the next tick", async () => {
  const scheduler = new Scheduler({ client: { logger: { error: () => {} } } });
  let ran = 0;
  scheduler.register("MISSED", async () => {
    ran += 1;
  });

  await scheduler.schedule({
    type: "MISSED",
    guildId: GUILD_ID,
    runAt: new Date(Date.now() - 6 * 60 * 60 * 1000),
  });

  await scheduler.tick();
  assert.equal(ran, 1);
});

test("re-scheduling the same dedupe key reschedules instead of duplicating", async () => {
  const scheduler = new Scheduler({ client: { logger: { error: () => {} } } });
  scheduler.register("TEMP", async () => {});

  const key = "TEMP:guild:user:role";
  await scheduler.schedule({ type: "TEMP", guildId: GUILD_ID, runAt: Date.now() + 1000, dedupeKey: key });
  await scheduler.schedule({ type: "TEMP", guildId: GUILD_ID, runAt: Date.now() + 90_000, dedupeKey: key });

  const docs = await scheduledTask.model.find({}).lean();
  assert.equal(docs.length, 1);
  assert.ok(docs[0].run_at.getTime() > Date.now() + 60_000, "the later deadline won");
});

test("a failing handler is retried with backoff and dropped after the attempt limit", async () => {
  const scheduler = new Scheduler({ client: { logger: { error: () => {} } } });
  scheduler.register("BOOM", async () => {
    throw new Error("nope");
  });

  await scheduler.schedule({ type: "BOOM", guildId: GUILD_ID, runAt: Date.now() - 1000 });

  const result = await scheduler.tick();
  assert.equal(result.failed, 1);

  const [doc] = await scheduledTask.model.find({}).lean();
  assert.equal(doc.attempts, 1);
  assert.equal(doc.last_error, "nope");
  assert.ok(doc.run_at.getTime() > Date.now(), "the retry is pushed into the future");

  await scheduledTask.model.updateOne(
    { _id: doc._id },
    { $set: { attempts: scheduledTask.MAX_ATTEMPTS, run_at: new Date(Date.now() - 1000) } }
  );
  await scheduler.tick();
  assert.equal(await scheduledTask.model.countDocuments({}), 0, "hopeless task is dropped");
});

test("claimed tasks are leased so a second worker skips them", async () => {
  await scheduledTask.scheduleTask({ type: "LEASED", guildId: GUILD_ID, runAt: Date.now() - 1000 });

  const first = await scheduledTask.claimDueTasks({ types: ["LEASED"] });
  const second = await scheduledTask.claimDueTasks({ types: ["LEASED"] });

  assert.equal(first.length, 1);
  assert.equal(second.length, 0);
});

test("tasks are filtered, listed and cancelled by guild and payload", async () => {
  await scheduledTask.scheduleTask({
    type: "TEMP_ROLE_REMOVE",
    guildId: GUILD_ID,
    runAt: Date.now() + 1000,
    payload: { userId: "1", roleId: "r1" },
  });
  await scheduledTask.scheduleTask({
    type: "TEMP_ROLE_REMOVE",
    guildId: GUILD_ID,
    runAt: Date.now() + 2000,
    payload: { userId: "2", roleId: "r2" },
  });

  const mine = await scheduledTask.listTasks({
    type: "TEMP_ROLE_REMOVE",
    guildId: GUILD_ID,
    payloadMatch: { userId: "1" },
  });
  assert.equal(mine.length, 1);

  const cancelled = await scheduledTask.cancelTasks({ guildId: GUILD_ID, payloadMatch: { userId: "2" } });
  assert.equal(cancelled, 1);
  assert.equal(await scheduledTask.model.countDocuments({}), 1);

  await assert.rejects(() => scheduledTask.cancelTasks({}), /Refusing to cancel/);
});
