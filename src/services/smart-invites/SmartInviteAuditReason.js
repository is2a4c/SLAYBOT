const MAX_REASON_LENGTH = 512;

const templates = {
  create: ({ slug, actor }) =>
    `SLAYBOT Smart Invites: внутреннее приглашение для ссылки "${slug}" создано администратором ${actor.username} (${actor.id}).`,
  regenerate: ({ slug }) =>
    `SLAYBOT Smart Invites: автоматически заменено недействительное приглашение для ссылки "${slug}".`,
  refresh: ({ slug, actor }) =>
    `SLAYBOT Smart Invites: приглашение для ссылки "${slug}" обновлено администратором ${actor.username} (${actor.id}).`,
  "set-channel": ({ slug, actor }) =>
    `SLAYBOT Smart Invites: создано новое приглашение для ссылки "${slug}" после изменения канала администратором ${actor.username} (${actor.id}).`,
};

function sanitizeAuditValue(value, maxLength) {
  return String(value || "")
    .split("")
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code > 31 && (code < 127 || code > 159);
    })
    .join("")
    .replace(/[^\p{L}\p{N}_. -]/gu, "")
    .trim()
    .slice(0, maxLength);
}

function buildSmartInviteAuditReason({ action, slug, actor }) {
  if (!Object.prototype.hasOwnProperty.call(templates, action)) {
    throw new TypeError(`Unsupported Smart Invite audit action: ${action}`);
  }
  const safeActor = {
    id: sanitizeAuditValue(actor?.id, 20) || "unknown",
    username: sanitizeAuditValue(actor?.username || actor?.tag, 64) || "unknown",
  };
  const reason = templates[action]({
    slug: sanitizeAuditValue(slug, 32),
    actor: safeActor,
  });
  return reason.slice(0, MAX_REASON_LENGTH);
}

module.exports = {
  MAX_REASON_LENGTH,
  buildSmartInviteAuditReason,
  sanitizeAuditValue,
};
