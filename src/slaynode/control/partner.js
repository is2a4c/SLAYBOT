const crypto = require("crypto");
const models = require("../../database/schemas/slaynode");
const { JOB_TYPES, PRIVACY, digest } = require("../protocol");

const DEFAULT_TIERS = [
  { name: "Platinum", score: 90 },
  { name: "Gold", score: 75 },
  { name: "Silver", score: 55 },
  { name: "Bronze", score: 0 },
];

const WEIGHTS = { contribution: 0.35, reliability: 0.25, uptime: 0.2, latency: 0.1, canary: 0.1 };

function tierForScore(score, tiers = DEFAULT_TIERS) {
  return [...tiers].sort((a, b) => b.score - a.score).find((item) => score >= item.score)?.name || "Bronze";
}

// Pure scoring so both the hourly recompute and /slaynode can explain a tier the same way.
async function scoreGuild(guildId, tiers = DEFAULT_TIERS, windowDays = 30) {
  const since = new Date(Date.now() - windowDays * 86400_000);
  const [metrics, credits] = await Promise.all([
    models.NodeDailyMetrics.aggregate([
      { $match: { guildId, day: { $gte: since } } },
      {
        $group: {
          _id: null,
          uptime: { $sum: "$uptimeSeconds" },
          accepted: { $sum: "$accepted" },
          rejected: { $sum: "$rejected" },
          canaries: { $sum: "$canaryPassed" },
          latency: { $sum: "$latencyTotalMs" },
        },
      },
    ]),
    models.CreditLedgerEntry.aggregate([
      { $match: { guildId, createdAt: { $gte: since }, amountMicros: { $gt: 0 } } },
      { $group: { _id: null, amount: { $sum: "$amountMicros" } } },
    ]),
  ]);
  const m = metrics[0] || {};
  const total = (m.accepted || 0) + (m.rejected || 0);
  const creditsWindow = credits[0]?.amount || 0;
  const components = {
    contribution: Math.min(1, creditsWindow / 1_000_000),
    reliability: total ? m.accepted / total : 0,
    uptime: Math.min(1, (m.uptime || 0) / (windowDays * 86400)),
    latency: Math.max(0, 1 - (m.accepted ? m.latency / m.accepted : 60_000) / 60_000),
    canary: Math.min(1, (m.canaries || 0) / 20),
  };
  const score = 100 * Object.keys(WEIGHTS).reduce((sum, key) => sum + WEIGHTS[key] * components[key], 0);
  return {
    score,
    tier: tierForScore(score, tiers),
    components,
    creditsWindowMicros: creditsWindow,
    accepted: m.accepted || 0,
    rejected: m.rejected || 0,
    windowDays,
  };
}

async function calculateGuildTier(guildId, tiers = DEFAULT_TIERS, windowDays = 30) {
  const scored = await scoreGuild(guildId, tiers, windowDays);
  return models.GuildPartnerAccount.findOneAndUpdate(
    { guildId },
    { $set: { tier: scored.tier, tierScore: scored.score, tierCalculatedAt: new Date() } },
    { upsert: true, new: true }
  );
}

async function enqueueCanaries(queue) {
  const nodes = await models.Node.find({ status: "ONLINE", capabilities: JOB_TYPES.CANARY_SHA256 });
  const created = [];
  for (const node of nodes) {
    const value = crypto.randomBytes(16).toString("hex");
    const result = { sha256: crypto.createHash("sha256").update(value).digest("hex") };
    created.push(
      await queue.enqueue({
        type: JOB_TYPES.CANARY_SHA256,
        privacyClass: PRIVACY.PUBLIC,
        targetNodeId: node.nodeId,
        payload: { value },
        canary: true,
        expectedDigest: digest(result),
        idempotencyKey: `canary:${node.nodeId}:${Math.floor(Date.now() / 3600000)}`,
        priority: 1000,
      })
    );
  }
  return created;
}

async function recalculateAllTiers(tiers) {
  const guilds = await models.GuildPartnerAccount.distinct("guildId");
  return Promise.all(guilds.map((guildId) => calculateGuildTier(guildId, tiers)));
}

module.exports = {
  DEFAULT_TIERS,
  WEIGHTS,
  tierForScore,
  scoreGuild,
  calculateGuildTier,
  enqueueCanaries,
  recalculateAllTiers,
};
