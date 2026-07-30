const test = require("node:test");
const assert = require("node:assert/strict");
require("module-alias/register");

const { buildStatusReport, formatUptime, overallStatus } = require("../src/services/status/StatusReport");

const healthyClient = (overrides = {}) => ({
  readyAt: new Date("2026-07-30T10:00:00.000Z"),
  uptime: 3_600_000,
  ws: { ping: 42, shards: new Map([[0, { id: 0, ping: 42, status: 0 }]]) },
  guilds: { cache: { size: 12 } },
  channels: { cache: { size: 340 } },
  slashCommands: { size: 98 },
  scheduler: { timer: {} },
  feedWatcher: { timer: {} },
  ...overrides,
});

test("the worst component decides the overall status", () => {
  assert.equal(overallStatus([{ status: "operational" }, { status: "operational" }]), "operational");
  assert.equal(overallStatus([{ status: "operational" }, { status: "degraded" }]), "degraded");
  assert.equal(overallStatus([{ status: "degraded" }, { status: "outage" }]), "outage");
});

test("uptime is formatted for humans", () => {
  assert.equal(formatUptime(59), "0m");
  assert.equal(formatUptime(3600), "1h 0m");
  assert.equal(formatUptime(90_061), "1d 1h 1m");
});

test("a healthy bot with a connected database reports operational", () => {
  const report = buildStatusReport({ client: healthyClient(), connectionState: 1 });

  assert.equal(report.status, "operational");
  assert.equal(report.uptime.human, "1h 0m");
  assert.equal(report.metrics.guilds, 12);
  assert.equal(report.metrics.commands, 98);
  assert.equal(report.metrics.gatewayPingMs, 42);
  assert.equal(report.shards.length, 1);
});

test("a slow gateway or a disconnected database degrades the report", () => {
  const slow = buildStatusReport({
    client: healthyClient({ ws: { ping: 900, shards: new Map() } }),
    connectionState: 1,
  });
  assert.equal(slow.status, "degraded");
  assert.equal(slow.components.find((component) => component.id === "gateway").status, "degraded");

  const noDb = buildStatusReport({ client: healthyClient(), connectionState: 0 });
  assert.equal(noDb.status, "outage");

  const connecting = buildStatusReport({ client: healthyClient(), connectionState: 2 });
  assert.equal(connecting.status, "degraded");
});

test("a bot that never became ready is an outage", () => {
  const report = buildStatusReport({ client: healthyClient({ readyAt: null }), connectionState: 1 });

  assert.equal(report.status, "outage");
  assert.equal(report.components.find((component) => component.id === "gateway").detail, "not connected");
});

test("stopped background workers are reported as degraded", () => {
  const report = buildStatusReport({
    client: healthyClient({ scheduler: { timer: null }, feedWatcher: undefined }),
    connectionState: 1,
  });

  assert.equal(report.status, "degraded");
  assert.equal(report.components.find((component) => component.id === "scheduler").detail, "stopped");
  assert.equal(report.components.find((component) => component.id === "feeds").detail, "not started");
});

test("the payload carries no guild identity", () => {
  const serialized = JSON.stringify(buildStatusReport({ client: healthyClient(), connectionState: 1 }));

  assert.ok(!/guildId|guild_id|"name":"[^"]*server/i.test(serialized));
  assert.ok(!serialized.includes("token"));
});
