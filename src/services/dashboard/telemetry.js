const EMPTY_COUNTERS = Object.freeze({
  commands: 0,
  messages: 0,
  automod_actions: 0,
  client_errors: 0,
});

function emptySummary() {
  return {
    counters: { ...EMPTY_COUNTERS },
    activeUsers: null,
    commandLatency: { averageMs: 0 },
  };
}

/**
 * Reads dashboard telemetry without making the dashboard depend on the
 * optional telemetry runtime. Deployments that do not have that runtime yet
 * still render every page; once it is attached to the client, the same routes
 * automatically use its live values.
 *
 * @param {object} client
 * @param {object} query
 */
async function getDashboardTelemetrySummary(client, query) {
  if (typeof client?.telemetry?.getSummary !== "function") return emptySummary();

  try {
    const summary = await client.telemetry.getSummary(query);
    return {
      ...emptySummary(),
      ...summary,
      counters: { ...EMPTY_COUNTERS, ...(summary?.counters || {}) },
      commandLatency: { averageMs: 0, ...(summary?.commandLatency || {}) },
    };
  } catch (error) {
    client.logger?.warn?.(`Dashboard telemetry unavailable: ${error.message}`);
    return emptySummary();
  }
}

module.exports = { EMPTY_COUNTERS, emptySummary, getDashboardTelemetrySummary };
