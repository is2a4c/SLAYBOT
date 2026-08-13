const { randomUUID } = require("node:crypto");

const ACTIONS = ["TIMEOUT", "KICK", "BAN"];

class AutomodEscalationError extends Error {}

function clampInt(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function createEscalationRule(body, id = randomUUID()) {
  const action = String(body.action || "").toUpperCase();
  if (!ACTIONS.includes(action)) throw new AutomodEscalationError("Invalid escalation action.");

  return {
    id,
    threshold: clampInt(body.threshold, 1, 1000, 1),
    action,
    timeout_minutes: action === "TIMEOUT" ? clampInt(body.timeout_minutes, 1, 40320, 1440) : 1440,
  };
}

function addEscalationRule(current, rule) {
  const rules = [...(current || []).map(toPlainRule)];
  if (rules.length >= 10) throw new AutomodEscalationError("No more than 10 escalation rules are allowed.");
  if (rules.some((entry) => entry.threshold === rule.threshold)) {
    throw new AutomodEscalationError("A rule for this strike threshold already exists.");
  }
  rules.push(rule);
  return rules.sort((left, right) => left.threshold - right.threshold);
}

function toPlainRule(entry) {
  return {
    id: entry.id,
    threshold: entry.threshold,
    action: entry.action,
    timeout_minutes: entry.timeout_minutes,
  };
}

function removeEscalationRule(current, id) {
  return (current || []).filter((entry) => entry.id !== id).map(toPlainRule);
}

function selectEscalationRule(current, strikes, previousStrikes = 0) {
  return (
    [...(current || [])]
      .filter(
        (entry) => entry.threshold > previousStrikes && entry.threshold <= strikes && ACTIONS.includes(entry.action)
      )
      .sort((left, right) => right.threshold - left.threshold)[0] || null
  );
}

module.exports = {
  ACTIONS,
  AutomodEscalationError,
  addEscalationRule,
  createEscalationRule,
  removeEscalationRule,
  selectEscalationRule,
};
