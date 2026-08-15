const test = require("node:test");
const assert = require("node:assert/strict");
require("module-alias/register");

const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const { getMember, model: memberModel } = require("@schemas/Member");
const { model: modLogModel } = require("@schemas/ModLog");
const { model: guildModel } = require("@schemas/Guild");
const { listTasks } = require("@schemas/ScheduledTask");
const {
  SWEEP_INTERVAL_MS,
  TASK_TYPE,
  decayExpiredWarnings,
  ensureScheduled,
  handleSweep,
} = require("@src/services/moderation/warningExpiry");

let mongo;
let nextId = 700000000000000000n;
function freshId() {
  nextId += 1n;
  return String(nextId);
}

test.before(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
});

test.after(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

async function seedWarnLog(guildId, memberId, daysAgo) {
  const log = await modLogModel.create({
    guild_id: guildId,
    member_id: memberId,
    reason: "test",
    admin: { id: "1", tag: "tester" },
    type: "WARN",
  });

  // Mongoose treats a schema's own createdAt timestamp path as something it
  // alone manages and quietly no-ops a query-level update to it - the native
  // driver has no such opinion, and this is only ever backdating a fixture.
  await mongoose.connection.db
    .collection("mod-logs")
    .updateOne({ _id: log._id }, { $set: { created_at: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000) } });
}

/* ------------------------------------------------------------- ensureScheduled */

test("ensureScheduled arranges a sweep a day out, and does not duplicate one already pending", async () => {
  const guildId = freshId();
  await ensureScheduled(guildId);
  const first = await listTasks({ type: TASK_TYPE, guildId });
  assert.equal(first.length, 1);
  assert.ok(first[0].run_at.getTime() - Date.now() > SWEEP_INTERVAL_MS - 5000);

  await ensureScheduled(guildId);
  const second = await listTasks({ type: TASK_TYPE, guildId });
  assert.equal(second.length, 1, "a second call did not schedule a duplicate");
  assert.equal(second[0]._id.toString(), first[0]._id.toString());
});

/* --------------------------------------------------------- decayExpiredWarnings */

test("decayExpiredWarnings drops a member's count to how many WARN entries are still within the window", async () => {
  const guildId = freshId();
  const memberId = freshId();

  const memberDb = await getMember(guildId, memberId);
  memberDb.warnings = 3;
  await memberDb.save();

  await seedWarnLog(guildId, memberId, 1); // still active
  await seedWarnLog(guildId, memberId, 10); // still active
  await seedWarnLog(guildId, memberId, 45); // expired under a 30-day window

  await decayExpiredWarnings(guildId, 30);

  const after = await memberModel.findOne({ guild_id: guildId, member_id: memberId }).lean();
  assert.equal(after.warnings, 2);
});

test("decayExpiredWarnings leaves a member alone once their count already matches", async () => {
  const guildId = freshId();
  const memberId = freshId();

  const memberDb = await getMember(guildId, memberId);
  memberDb.warnings = 1;
  await memberDb.save();
  await seedWarnLog(guildId, memberId, 1);

  await decayExpiredWarnings(guildId, 30);

  const after = await memberModel.findOne({ guild_id: guildId, member_id: memberId }).lean();
  assert.equal(after.warnings, 1);
});

test("decayExpiredWarnings never touches a member who already has none", async () => {
  const guildId = freshId();
  const memberId = freshId();
  await getMember(guildId, memberId); // creates with warnings: 0, never saved to the db

  await assert.doesNotReject(decayExpiredWarnings(guildId, 30));
  const after = await memberModel.findOne({ guild_id: guildId, member_id: memberId });
  assert.equal(after, null, "nothing was ever persisted, since there was nothing to decay");
});

/* -------------------------------------------------------------------- handleSweep */

function fakeClient(guild) {
  return {
    guilds: {
      cache: new Map(guild ? [[guild.id, guild]] : []),
      fetch: async (id) => (guild?.id === id ? guild : null),
    },
  };
}

test("handleSweep decays warnings and re-arms for tomorrow while expiry is still on", async () => {
  const guildId = freshId();
  await guildModel.create({ _id: guildId, control_center: { moderation: { warning_expiry_days: 30 } } });
  const memberId = freshId();
  const memberDb = await getMember(guildId, memberId);
  memberDb.warnings = 1;
  await memberDb.save();
  await seedWarnLog(guildId, memberId, 45); // expired

  const guild = { id: guildId };
  await handleSweep({}, { client: fakeClient(guild), task: { guild_id: guildId } });

  const after = await memberModel.findOne({ guild_id: guildId, member_id: memberId }).lean();
  assert.equal(after.warnings, 0);

  const rescheduled = await listTasks({ type: TASK_TYPE, guildId });
  assert.equal(rescheduled.length, 1, "tomorrow's sweep was armed");
});

test("handleSweep does nothing and does not re-arm once expiry is turned off", async () => {
  const guildId = freshId();
  await guildModel.create({ _id: guildId, control_center: { moderation: { warning_expiry_days: 0 } } });
  const memberId = freshId();
  const memberDb = await getMember(guildId, memberId);
  memberDb.warnings = 1;
  await memberDb.save();
  await seedWarnLog(guildId, memberId, 45);

  await handleSweep({}, { client: fakeClient({ id: guildId }), task: { guild_id: guildId } });

  const after = await memberModel.findOne({ guild_id: guildId, member_id: memberId }).lean();
  assert.equal(after.warnings, 1, "no expiry means no decay");

  const rescheduled = await listTasks({ type: TASK_TYPE, guildId });
  assert.equal(rescheduled.length, 0, "a server that turned expiry off is not swept again on its own");
});

test("handleSweep quietly stops when the guild is gone", async () => {
  const guildId = freshId();
  await assert.doesNotReject(handleSweep({}, { client: fakeClient(null), task: { guild_id: guildId } }));
  assert.equal((await listTasks({ type: TASK_TYPE, guildId })).length, 0);
});
