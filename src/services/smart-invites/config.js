const SmartInviteError = require("./SmartInviteError");

const NUMERIC_KEYS = [
  "port",
  "maxPerGuild",
  "validationTtlMs",
  "healthCheckIntervalMs",
  "regenerationLeaseMs",
  "deletedSlugRetentionMs",
  "aliasRetentionMs",
  "commandCooldownSeconds",
  "publicRateLimitWindowMs",
  "publicRateLimitMax",
  "backgroundConcurrency",
];

function normalizeBaseURL(value, environment = process.env.NODE_ENV) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new SmartInviteError("INVALID_CONFIG", "SMART_INVITES.baseURL должен быть абсолютным URL.");
  }

  const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (environment === "production" && url.protocol !== "https:" && !local) {
    throw new SmartInviteError("INVALID_CONFIG", "SMART_INVITES.baseURL должен использовать HTTPS в production.");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new SmartInviteError("INVALID_CONFIG", "SMART_INVITES.baseURL содержит недопустимые компоненты.");
  }
  return url.toString().replace(/\/$/, "");
}

function validateSmartInviteConfiguration(config, environment = process.env.NODE_ENV) {
  const errors = [];
  if (!config || typeof config !== "object") return ["SMART_INVITES отсутствует в конфигурации."];
  if (!["preview", "redirect"].includes(config.redirectMode)) {
    errors.push("SMART_INVITES.redirectMode должен быть preview или redirect.");
  }
  try {
    normalizeBaseURL(config.baseURL, environment);
  } catch (error) {
    errors.push(error.safeMessage || error.message);
  }
  for (const key of NUMERIC_KEYS) {
    if (!Number.isInteger(config[key]) || config[key] <= 0) {
      errors.push(`SMART_INVITES.${key} должен быть положительным целым числом.`);
    }
  }
  if (!Array.isArray(config.reservedSlugs) || !Array.isArray(config.blockedGuildIds)) {
    errors.push("SMART_INVITES.reservedSlugs и blockedGuildIds должны быть массивами.");
  }
  if (typeof config.host !== "string" || !config.host) errors.push("SMART_INVITES.host не задан.");
  if (
    typeof config.pathPrefix !== "string" ||
    (config.pathPrefix &&
      (!config.pathPrefix.startsWith("/") ||
        config.pathPrefix.endsWith("/") ||
        !/^\/[a-z0-9/_-]+$/i.test(config.pathPrefix)))
  ) {
    errors.push("SMART_INVITES.pathPrefix должен быть пустым или безопасным путём без завершающего слеша.");
  }
  return errors;
}

function publicInviteURL(config, slug) {
  return `${normalizeBaseURL(config.baseURL)}${config.pathPrefix || ""}/${slug}`;
}

module.exports = {
  normalizeBaseURL,
  validateSmartInviteConfiguration,
  publicInviteURL,
};
