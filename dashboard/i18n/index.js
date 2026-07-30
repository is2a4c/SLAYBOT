const ru = require("./locales/ru");
const en = require("./locales/en");

const LOCALES = { ru, en };
const DEFAULT_LOCALE = "ru";
const COOKIE_NAME = "slaybot_dashboard_lang";
const COOKIE_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

const LOCALE_LABELS = { ru: "Русский", en: "English" };

/**
 * Pick a locale from an Accept-Language header.
 * @param {string} header
 * @returns {string|null}
 */
function fromAcceptLanguage(header) {
  if (!header) return null;

  const ranked = String(header)
    .split(",")
    .map((entry) => {
      const [tag, ...params] = entry.trim().split(";");
      const quality = params.find((param) => param.trim().startsWith("q="));
      return { tag: tag.trim().toLowerCase(), q: quality ? Number.parseFloat(quality.split("=")[1]) || 0 : 1 };
    })
    .filter((entry) => entry.tag)
    .sort((a, b) => b.q - a.q);

  for (const { tag } of ranked) {
    const base = tag.split("-")[0];
    if (LOCALES[base]) return base;
  }

  return null;
}

/**
 * Resolve which language a request should be rendered in.
 *
 * Order: explicit ?lang= (which also sets the cookie), the stored cookie, the
 * browser's Accept-Language, then the default.
 *
 * @param {{query?: string, cookie?: string, acceptLanguage?: string}} input
 * @returns {{locale: string, persist: boolean}}
 */
function resolveLocale({ query, cookie, acceptLanguage } = {}) {
  const requested = String(query || "").toLowerCase();
  if (LOCALES[requested]) return { locale: requested, persist: true };

  const stored = String(cookie || "").toLowerCase();
  if (LOCALES[stored]) return { locale: stored, persist: false };

  return { locale: fromAcceptLanguage(acceptLanguage) || DEFAULT_LOCALE, persist: false };
}

/**
 * Look up a dotted key, falling back to the default locale and finally to the key
 * itself, so a missing translation degrades to something readable instead of
 * rendering "undefined".
 *
 * @param {string} locale
 * @param {string} key
 * @param {object} [vars] `{name}` placeholders
 */
function translate(locale, key, vars = {}) {
  const read = (dictionary) =>
    String(key)
      .split(".")
      .reduce((value, part) => value?.[part], dictionary);

  const template = read(LOCALES[locale]) ?? read(LOCALES[DEFAULT_LOCALE]) ?? key;

  return String(template).replace(/{(\w+)}/g, (match, name) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match
  );
}

/**
 * Express middleware: exposes `t`, `locale` and the language switcher data to
 * every template, and remembers an explicit choice in a cookie.
 */
function localeMiddleware(req, res, next) {
  const cookieHeader = req.headers?.cookie || "";
  const cookieValue = cookieHeader
    .split(";")
    .map((entry) => entry.trim().split("="))
    .find(([name]) => name === COOKIE_NAME)?.[1];

  const { locale, persist } = resolveLocale({
    query: req.query?.lang,
    cookie: cookieValue,
    acceptLanguage: req.headers?.["accept-language"],
  });

  if (persist) {
    res.cookie?.(COOKIE_NAME, locale, {
      httpOnly: false,
      sameSite: "lax",
      maxAge: COOKIE_MAX_AGE_MS,
      path: "/",
    });
  }

  res.locals.locale = locale;
  res.locals.locales = Object.keys(LOCALES).map((code) => ({
    code,
    label: LOCALE_LABELS[code] || code,
    active: code === locale,
  }));
  res.locals.t = (key, vars) => translate(locale, key, vars);
  res.locals.formatDate = (value) =>
    new Date(value).toLocaleString(locale === "ru" ? "ru-RU" : "en-GB", { timeZone: "UTC" });

  next();
}

module.exports = {
  COOKIE_NAME,
  DEFAULT_LOCALE,
  LOCALES,
  LOCALE_LABELS,
  fromAcceptLanguage,
  localeMiddleware,
  resolveLocale,
  translate,
};
