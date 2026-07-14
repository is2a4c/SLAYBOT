// Pure rendering helpers for the /slaynode command. No Discord or database dependencies
// so the presentation layer stays unit-testable and consistent across subcommands.

const TIER_META = {
  Bronze: { emoji: "🥉", color: 0xcd7f32 },
  Silver: { emoji: "🥈", color: 0xc0c0c0 },
  Gold: { emoji: "🥇", color: 0xffd700 },
  Platinum: { emoji: "💎", color: 0xb9f2ff },
};

const STATUS_META = {
  ONLINE: "🟢",
  DEGRADED: "🟡",
  OFFLINE: "⚪",
  REVOKED: "⛔",
};

const COMPONENT_LABELS = {
  contribution: "Contribution",
  reliability: "Reliability",
  uptime: "Uptime",
  latency: "Latency",
  canary: "Canary checks",
};

const clamp01 = (value) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

const tierMeta = (tier) => TIER_META[tier] || TIER_META.Bronze;
const statusEmoji = (status) => STATUS_META[status] || "⚪";

// Credits are stored as integer micro-units; players see the whole count, which reads
// as a satisfying reward instead of a tiny fraction.
const formatCredits = (micros) => Math.round(Number(micros) || 0).toLocaleString("en-US");

function progressBar(fraction, width = 14) {
  const filled = Math.round(clamp01(fraction) * width);
  return `${"█".repeat(filled)}${"░".repeat(width - filled)} ${Math.round(clamp01(fraction) * 100)}%`;
}

function nextTier(tier, tiers) {
  const ordered = [...tiers].sort((a, b) => a.score - b.score);
  const index = ordered.findIndex((item) => item.name === tier);
  return index >= 0 ? ordered[index + 1] || null : null;
}

// Progress of the current score toward the next tier's threshold.
function tierProgress(score, tier, tiers) {
  const ordered = [...tiers].sort((a, b) => a.score - b.score);
  const current = ordered.find((item) => item.name === tier) || ordered[0];
  const next = nextTier(tier, tiers);
  if (!next) return { maxed: true, bar: progressBar(1), next: null, pointsToNext: 0 };
  const span = Math.max(1, next.score - (current?.score || 0));
  const fraction = (score - (current?.score || 0)) / span;
  return {
    maxed: false,
    bar: progressBar(fraction),
    next: next.name,
    pointsToNext: Math.max(0, next.score - score),
  };
}

function componentBars(components) {
  return Object.keys(COMPONENT_LABELS).map(
    (key) => `${COMPONENT_LABELS[key].padEnd(14)} ${progressBar(components[key], 10)}`
  );
}

function relativeTime(date, now = Date.now()) {
  if (!date) return "never";
  const seconds = Math.floor((now - new Date(date).getTime()) / 1000);
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function fleetSummary(nodes) {
  const online = nodes.filter((node) => node.status === "ONLINE").length;
  const capacity = nodes.reduce((sum, node) => sum + (node.limits?.parallelism || node.resources?.parallelism || 1), 0);
  const gpu = nodes.filter((node) => node.resources?.gpu).length;
  return { total: nodes.length, online, capacity, gpu };
}

function nodeLine(node, creditsMicros = 0, now = Date.now()) {
  const parallelism = node.limits?.parallelism || node.resources?.parallelism || 1;
  const reliability = `${(clamp01(node.reliability) * 100).toFixed(0)}%`;
  const parts = [
    `${statusEmoji(node.status)} **${node.name}**`,
    `${reliability} rel`,
    `${node.load?.running || 0}/${parallelism} load`,
    `${Math.round(node.latencyMs || 0)}ms`,
    `${formatCredits(creditsMicros)} cr`,
    relativeTime(node.lastHeartbeatAt, now),
  ];
  return parts.join(" · ");
}

module.exports = {
  TIER_META,
  STATUS_META,
  COMPONENT_LABELS,
  tierMeta,
  statusEmoji,
  formatCredits,
  progressBar,
  nextTier,
  tierProgress,
  componentBars,
  relativeTime,
  fleetSummary,
  nodeLine,
};
