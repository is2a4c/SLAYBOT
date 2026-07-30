const mongoose = require("mongoose");

const DEGRADED_PING_MS = 500;
const READY_STATE_LABELS = {
  0: "disconnected",
  1: "connected",
  2: "connecting",
  3: "disconnecting",
};

/**
 * Roll a set of component states into one overall state.
 *
 * Pure so the status page, the JSON endpoint and any monitor agree on what
 * "degraded" means: any failure is an outage, any warning is degraded.
 *
 * @param {Array<{status: string}>} components
 * @returns {"operational"|"degraded"|"outage"}
 */
function overallStatus(components) {
  if (components.some((component) => component.status === "outage")) return "outage";
  if (components.some((component) => component.status === "degraded")) return "degraded";
  return "operational";
}

/**
 * @param {number} seconds
 */
function formatUptime(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);

  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours || days) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  return parts.join(" ");
}

/**
 * Build the public status payload.
 *
 * Deliberately free of identifying data: counts and health only, so the page can
 * be shared without leaking which servers the bot is in.
 *
 * @param {{client: object, now?: Date, connectionState?: number, uptimeSeconds?: number}} input
 */
function buildStatusReport({ client, now = new Date(), connectionState, uptimeSeconds } = {}) {
  const gatewayPing = Math.round(client?.ws?.ping ?? -1);
  const readyState = connectionState ?? mongoose.connection?.readyState ?? 0;

  const gateway = {
    id: "gateway",
    name: "Discord gateway",
    status: !client?.readyAt
      ? "outage"
      : gatewayPing < 0 || gatewayPing > DEGRADED_PING_MS
        ? "degraded"
        : "operational",
    detail: client?.readyAt ? `${gatewayPing} ms` : "not connected",
  };

  const database = {
    id: "database",
    name: "Database",
    status: readyState === 1 ? "operational" : readyState === 2 ? "degraded" : "outage",
    detail: READY_STATE_LABELS[readyState] || "unknown",
  };

  const shards = [...(client?.ws?.shards?.values?.() || [])].map((shard) => ({
    id: shard.id,
    ping: Math.round(shard.ping ?? -1),
    status: shard.status,
  }));

  const scheduler = client?.scheduler
    ? {
        id: "scheduler",
        name: "Scheduled tasks",
        status: client.scheduler.timer ? "operational" : "degraded",
        detail: client.scheduler.timer ? "polling" : "stopped",
      }
    : { id: "scheduler", name: "Scheduled tasks", status: "degraded", detail: "not started" };

  const feeds = client?.feedWatcher
    ? {
        id: "feeds",
        name: "Feed watcher",
        status: client.feedWatcher.timer ? "operational" : "degraded",
        detail: client.feedWatcher.timer ? "polling" : "stopped",
      }
    : { id: "feeds", name: "Feed watcher", status: "degraded", detail: "not started" };

  const components = [gateway, database, scheduler, feeds];

  return {
    status: overallStatus(components),
    generatedAt: now.toISOString(),
    uptime: {
      seconds: Math.floor(uptimeSeconds ?? (client?.uptime ?? 0) / 1000),
      human: formatUptime(uptimeSeconds ?? (client?.uptime ?? 0) / 1000),
      since: client?.readyAt ? new Date(client.readyAt).toISOString() : null,
    },
    components,
    metrics: {
      guilds: client?.guilds?.cache?.size ?? 0,
      channels: client?.channels?.cache?.size ?? 0,
      commands: client?.slashCommands?.size ?? 0,
      shards: shards.length,
      gatewayPingMs: gatewayPing,
      memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
    },
    shards,
  };
}

module.exports = {
  DEGRADED_PING_MS,
  buildStatusReport,
  formatUptime,
  overallStatus,
};
