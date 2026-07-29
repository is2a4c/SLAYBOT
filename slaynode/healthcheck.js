const fs = require("fs");

const healthPath = process.env.SLAYNODE_HEALTH_FILE || "/tmp/slaynode-health.json";
const maxAgeMs = Math.max(15_000, Number(process.env.SLAYNODE_HEALTH_MAX_AGE_MS) || 45_000);

try {
  const health = JSON.parse(fs.readFileSync(healthPath, "utf8"));
  const ageMs = Date.now() - Number(health.lastConnectedAt || 0);
  if (health.stopping || !Number.isFinite(ageMs) || ageMs > maxAgeMs) process.exit(1);
  process.exit(0);
} catch {
  process.exit(1);
}
