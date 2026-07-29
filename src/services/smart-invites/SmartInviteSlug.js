const { CORE_RESERVED_SLUGS } = require("./constants");
const SmartInviteError = require("./SmartInviteError");

const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){1,30}[a-z0-9]$/;

function safelyDecodeSlug(input) {
  if (typeof input !== "string") throw invalidSlug();
  // Express already decodes path parameters once. A remaining percent sign is a
  // double-encoding attempt or an ambiguous path and must never become a slug.
  if (input.includes("%")) throw invalidSlug();
  let decoded;
  try {
    decoded = decodeURIComponent(input);
  } catch {
    throw invalidSlug();
  }
  if (decoded !== input && /%[0-9a-f]{2}/i.test(decoded)) throw invalidSlug();
  return decoded;
}

function normalizeSlug(input, options = {}) {
  const decoded = options.encodedPath ? safelyDecodeSlug(input) : input;
  if (typeof decoded !== "string") throw invalidSlug();

  const normalized = decoded.normalize("NFKC").toLowerCase();
  if (normalized !== decoded.toLowerCase() || !SLUG_PATTERN.test(normalized) || normalized.includes("--")) {
    throw invalidSlug();
  }
  return normalized;
}

function getReservedSlugs(config = {}, runtimeReserved = []) {
  return new Set(
    [...CORE_RESERVED_SLUGS, ...(config.reservedSlugs || []), ...runtimeReserved]
      .map((slug) => {
        try {
          return normalizeSlug(String(slug));
        } catch {
          return null;
        }
      })
      .filter(Boolean)
  );
}

function assertSlugAllowed(slug, config = {}, options = {}) {
  const normalized = normalizeSlug(slug, options);
  const officialSlug = normalizeSlug(config.officialSlug || "slaybot");
  const reserved = getReservedSlugs(config, options.runtimeReserved);

  if (reserved.has(normalized)) {
    throw new SmartInviteError("SLUG_RESERVED", "Этот адрес зарезервирован SLAYBOT.");
  }
  if (normalized === officialSlug && options.guildId !== config.officialGuildId) {
    throw new SmartInviteError("SLUG_RESERVED", "Этот адрес зарезервирован для официального сервера SLAYBOT.");
  }
  return normalized;
}

function invalidSlug() {
  return new SmartInviteError(
    "INVALID_SLUG",
    "Slug должен содержать 3–32 строчные латинские буквы, цифры или одиночные дефисы."
  );
}

module.exports = {
  SLUG_PATTERN,
  safelyDecodeSlug,
  normalizeSlug,
  getReservedSlugs,
  assertSlugAllowed,
};
