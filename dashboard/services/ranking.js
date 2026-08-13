const crypto = require("node:crypto");

class RankingError extends Error {
  constructor(message) {
    super(message);
    this.name = "RankingError";
  }
}

function selectedIds(value) {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  return [...new Set(list.map(String))];
}

function createReward(guild, input) {
  const type = input.type === "VOICE" ? "voice" : "level";
  const rawThreshold = Number.parseInt(input.threshold, 10);
  const threshold = type === "voice" ? rawThreshold * 60 : rawThreshold;
  const min = type === "voice" ? 300 : 2;
  const max = type === "voice" ? 315360000 : 10000;
  if (!Number.isSafeInteger(threshold) || threshold < min || threshold > max) {
    throw new RankingError(
      type === "voice" ? "Voice threshold must be 5 minutes to 10 years." : "Level must be 2 to 10000."
    );
  }

  const validRoles = (value) =>
    selectedIds(value).filter((id) => {
      const role = guild.roles.cache.get(id);
      return role && role.id !== guild.id && !role.managed;
    });
  const addRoles = validRoles(input.addRoles);
  const removeRoles = validRoles(input.removeRoles).filter((id) => !addRoles.includes(id));
  if (!addRoles.length && !removeRoles.length) throw new RankingError("Choose at least one role to add or remove.");

  return {
    type,
    reward: { id: crypto.randomUUID(), threshold, add_roles: addRoles, remove_roles: removeRoles },
  };
}

function addReward(existing, reward) {
  if ((existing || []).some((entry) => Number(entry.threshold) === Number(reward.threshold))) {
    throw new RankingError("A reward already exists at that threshold.");
  }
  return [...(existing || []).map((entry) => entry.toObject?.() || entry), reward].sort(
    (left, right) => left.threshold - right.threshold
  );
}

function removeReward(existing, id) {
  const next = (existing || []).filter((entry) => entry.id !== id).map((entry) => entry.toObject?.() || entry);
  if (next.length === (existing || []).length) throw new RankingError("Reward no longer exists.");
  return next;
}

function parseMemberStats(input) {
  const level = Number.parseInt(input.level, 10);
  const xp = Number.parseInt(input.xp, 10);
  const voiceMinutes = Number.parseInt(input.voiceMinutes, 10);
  if (!Number.isSafeInteger(level) || level < 1 || level > 10000) throw new RankingError("Level must be 1 to 10000.");
  if (!Number.isSafeInteger(xp) || xp < 0 || xp > 1000000000)
    throw new RankingError("XP is outside the supported range.");
  if (!Number.isSafeInteger(voiceMinutes) || voiceMinutes < 0 || voiceMinutes > 5256000) {
    throw new RankingError("Voice activity is outside the supported range.");
  }
  return { level, xp, voiceSeconds: voiceMinutes * 60 };
}

module.exports = { RankingError, addReward, createReward, parseMemberStats, removeReward, selectedIds };
