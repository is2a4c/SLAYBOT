const NAME_MAX_LENGTH = 100;
const LIMIT_MAX = 99;

/**
 * Decide whether somebody may drive the buttons on a temporary channel.
 *
 * Pure so the ownership rules stay testable without a Discord connection.
 *
 * @param {{record: object|null, userId: string}} input
 * @returns {{ok: boolean, reason: string|null, owner: string|null}}
 */
function checkControl({ record, userId }) {
  if (!record) return { ok: false, reason: "notTemporary", owner: null };
  if (record.owner_id !== userId) return { ok: false, reason: "notOwner", owner: record.owner_id };
  return { ok: true, reason: null, owner: record.owner_id };
}

/**
 * A channel can only be claimed by somebody sitting in it once the owner is gone.
 *
 * @param {{record: object|null, userId: string, memberIds: string[]|Set<string>}} input
 * @returns {{ok: boolean, reason: string|null, owner: string|null}}
 */
function checkClaim({ record, userId, memberIds }) {
  if (!record) return { ok: false, reason: "notTemporary", owner: null };
  if (record.owner_id === userId) return { ok: false, reason: "alreadyOwner", owner: record.owner_id };

  const present = memberIds instanceof Set ? memberIds : new Set(memberIds || []);
  if (present.has(record.owner_id)) return { ok: false, reason: "ownerPresent", owner: record.owner_id };

  return { ok: true, reason: null, owner: record.owner_id };
}

/**
 * Validate somebody a button acts on: not yourself, not a bot, not the owner.
 *
 * @param {{record: object, actorId: string, targetId: string, isBot?: boolean, allowOwner?: boolean}} input
 * @returns {{ok: boolean, reason: string|null}}
 */
function checkTarget({ record, actorId, targetId, isBot = false, allowOwner = false }) {
  if (targetId === actorId) return { ok: false, reason: "targetIsSelf" };
  if (isBot) return { ok: false, reason: "targetIsBot" };
  if (!allowOwner && targetId === record?.owner_id) return { ok: false, reason: "targetIsOwner" };
  return { ok: true, reason: null };
}

/**
 * @param {string} raw
 * @returns {{ok: boolean, value: string|null, reason: string|null}}
 */
function normalizeName(raw) {
  const value = String(raw ?? "")
    .replace(/\s+/g, " ")
    .trim();

  if (!value || value.length > NAME_MAX_LENGTH) return { ok: false, value: null, reason: "nameLength" };
  return { ok: true, value, reason: null };
}

/**
 * @param {string|number} raw
 * @returns {{ok: boolean, value: number|null, reason: string|null}}
 */
function normalizeLimit(raw) {
  const text = String(raw ?? "").trim();
  if (!/^\d{1,2}$/.test(text)) return { ok: false, value: null, reason: "limitRange" };

  const value = Number.parseInt(text, 10);
  if (value < 0 || value > LIMIT_MAX) return { ok: false, value: null, reason: "limitRange" };

  return { ok: true, value, reason: null };
}

/**
 * Build the name a freshly created channel gets.
 *
 * @param {string} template `{user}` and `{count}` placeholders
 * @param {{user: string, count?: number}} vars
 * @returns {string}
 */
function renderChannelName(template, { user, count = 1 }) {
  const rendered = String(template || "{user}")
    .replace(/{user}/g, user)
    .replace(/{count}/g, String(count))
    .trim();

  return (rendered || user).slice(0, NAME_MAX_LENGTH);
}

module.exports = {
  LIMIT_MAX,
  NAME_MAX_LENGTH,
  checkClaim,
  checkControl,
  checkTarget,
  normalizeLimit,
  normalizeName,
  renderChannelName,
};
