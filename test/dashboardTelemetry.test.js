require("module-alias/register");

const test = require("node:test");
const assert = require("node:assert/strict");
const { emptySummary, getDashboardTelemetrySummary } = require("../src/services/dashboard/telemetry");

test("dashboard pages receive safe metrics when telemetry is not installed", async () => {
  const summary = await getDashboardTelemetrySummary({}, { scope: "global", periodDays: 1 });

  assert.deepEqual(summary, emptySummary());
  assert.equal(summary.counters.messages, 0);
  assert.equal(summary.commandLatency.averageMs, 0);
});

test("dashboard telemetry fills missing fields without overwriting live values", async () => {
  const client = {
    telemetry: {
      getSummary: async () => ({
        counters: { messages: 42 },
        activeUsers: 7,
      }),
    },
  };

  const summary = await getDashboardTelemetrySummary(client, { scope: "guild" });

  assert.equal(summary.counters.messages, 42);
  assert.equal(summary.counters.client_errors, 0);
  assert.equal(summary.activeUsers, 7);
  assert.equal(summary.commandLatency.averageMs, 0);
});

test("a telemetry read failure degrades to safe metrics and logs a warning", async () => {
  const warnings = [];
  const client = {
    telemetry: {
      getSummary: async () => {
        throw new Error("database timeout");
      },
    },
    logger: { warn: (message) => warnings.push(message) },
  };

  const summary = await getDashboardTelemetrySummary(client, { scope: "global" });

  assert.deepEqual(summary, emptySummary());
  assert.match(warnings[0], /database timeout/);
});
