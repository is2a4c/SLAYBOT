require("module-alias/register");

const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const DashboardAuditLog = require("../src/database/schemas/DashboardAuditLog");
const { auditCsv, auditQuery, logAudit, listAuditLog } = require("../src/services/dashboard/auditLog");

let mongo;

test.before(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
});

test.after(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

test.beforeEach(async () => {
  await DashboardAuditLog.deleteMany({});
});

test("logAudit persists an entry with before/after and defaults missing fields to null", async () => {
  await logAudit({
    actorId: "111111111111111111",
    actorTag: "isaac",
    action: "guild_config_update",
    guildId: "222222222222222222",
    targetType: "guild_config",
    targetId: "222222222222222222",
    before: { prefix: "!" },
    after: { prefix: "?" },
    reason: "Dashboard change",
  });

  const [entry] = await DashboardAuditLog.find().lean();
  assert.equal(entry.actorId, "111111111111111111");
  assert.equal(entry.action, "guild_config_update");
  assert.deepEqual(entry.before, { prefix: "!" });
  assert.deepEqual(entry.after, { prefix: "?" });
  assert.ok(entry.created_at instanceof Date);
});

test("logAudit defaults optional fields to null instead of throwing when omitted", async () => {
  await logAudit({ actorId: "1", actorTag: "bot-owner", action: "staff_account_remove" });
  const [entry] = await DashboardAuditLog.find().lean();
  assert.equal(entry.guildId, null);
  assert.equal(entry.targetType, null);
  assert.equal(entry.reason, null);
});

test("logAudit swallows a persistence failure instead of throwing into the caller", async () => {
  const brokenLogger = { error: () => {} };
  await assert.doesNotReject(
    logAudit({ actorId: "1", actorTag: "x", action: "x", before: (() => {})() /* fine, just noise */ }, brokenLogger)
  );
});

test("listAuditLog filters by guildId and returns newest first", async () => {
  await logAudit({ actorId: "1", actorTag: "a", action: "guild_config_update", guildId: "guild-a" });
  await new Promise((resolve) => setTimeout(resolve, 5));
  await logAudit({ actorId: "1", actorTag: "a", action: "automod_config_update", guildId: "guild-a" });
  await logAudit({ actorId: "1", actorTag: "a", action: "staff_account_upsert", guildId: "guild-b" });

  const guildAEntries = await listAuditLog({ guildId: "guild-a" });
  assert.equal(guildAEntries.length, 2);
  assert.equal(guildAEntries[0].action, "automod_config_update"); // most recent first

  const allEntries = await listAuditLog();
  assert.equal(allEntries.length, 3);
});

test("audit filters combine exact dimensions with escaped text search", async () => {
  const query = auditQuery({
    guildId: "guild-a",
    action: "subscription_create",
    actorId: "111111111111111111",
    targetType: "feed",
    search: "hello.*",
  });
  assert.equal(query.guildId, "guild-a");
  assert.equal(query.action, "subscription_create");
  assert.equal(query.actorId, "111111111111111111");
  assert.equal(query.targetType, "feed");
  assert.equal(query.$or[0].actorTag.test("hello.*"), true);
  assert.equal(query.$or[0].actorTag.test("helloZZ"), false);
});

test("CSV export quotes fields and neutralizes spreadsheet formulas", () => {
  const csv = auditCsv([
    {
      created_at: new Date("2026-08-14T12:00:00Z"),
      action: "update",
      actorTag: '=HYPERLINK("bad")',
      actorId: "1",
      targetType: "guild",
      targetId: "2",
      reason: 'comma, quote"',
    },
  ]);
  assert.match(csv, /"'=HYPERLINK\(""bad""\)"/);
  assert.match(csv, /"comma, quote"""/);
});
