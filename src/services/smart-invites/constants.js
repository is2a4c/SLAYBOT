const DEFAULT_DESCRIPTION =
  "Постоянная ссылка для вступления на Discord-сервер, созданная и поддерживаемая SLAYBOT Smart Invites.";

const SERVICE_NOTICE =
  "SLAYBOT автоматически поддерживает актуальность этого приглашения. Внутренняя ссылка Discord может изменяться, но адрес этой страницы остаётся прежним.";

const CORE_RESERVED_SLUGS = [
  "api",
  "admin",
  "dashboard",
  "login",
  "logout",
  "health",
  "metrics",
  "invite",
  "invites",
  "discord",
  "support",
  "terms",
  "privacy",
  "abuse",
  "assets",
  "static",
  "favicon.ico",
  "robots.txt",
];

module.exports = {
  DEFAULT_DESCRIPTION,
  SERVICE_NOTICE,
  CORE_RESERVED_SLUGS,
};
