const ru = require("./locales/ru");
const en = require("./locales/en");

const LOCALES = { ru, en };

// The bot lives on servers of every language, so an unknown Discord locale falls
// back to English rather than to the dashboard's Russian default.
const DEFAULT_LOCALE = "en";
const LOCALE_LABELS = { ru: "Русский", en: "English" };

/**
 * Map a Discord locale tag ("ru", "en-US", "en-GB") onto a locale we ship.
 * @param {string} tag
 * @returns {string|null}
 */
function fromDiscordLocale(tag) {
  if (!tag) return null;
  const base = String(tag).toLowerCase().split("-")[0];
  return LOCALES[base] ? base : null;
}

/**
 * Resolve which language a message should be written in.
 *
 * Order: the language a server explicitly picked, then the locale of the person
 * we are answering (only for private replies), then the server's own Discord
 * locale, then the default.
 *
 * @param {{setting?: string, userLocale?: string, guildLocale?: string}} input
 * @returns {string}
 */
function resolveLocale({ setting, userLocale, guildLocale } = {}) {
  const explicit = String(setting || "").toLowerCase();
  if (LOCALES[explicit]) return explicit;

  return fromDiscordLocale(userLocale) || fromDiscordLocale(guildLocale) || DEFAULT_LOCALE;
}

/**
 * Look up a dotted key, falling back to the default locale and finally to the key
 * itself, so a missing translation degrades to something readable instead of
 * rendering "undefined".
 *
 * @param {string} locale
 * @param {string} key
 * @param {object} [vars] `{name}` placeholders
 * @returns {string}
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
 * Translator bound to a server. Use it for anything the whole server reads:
 * panels, log messages, announcements.
 *
 * @param {object} settings guild settings document
 * @param {import('discord.js').Guild} [guild]
 * @returns {((key: string, vars?: object) => string) & {locale: string}}
 */
function guildTranslator(settings, guild) {
  const locale = resolveLocale({ setting: settings?.language, guildLocale: guild?.preferredLocale });
  const t = (key, vars) => translate(locale, key, vars);
  t.locale = locale;
  return t;
}

/**
 * Translator bound to one interaction. A server that picked a language keeps it
 * for everyone; otherwise a private reply follows the client language of the
 * person who clicked.
 *
 * @param {import('discord.js').BaseInteraction} interaction
 * @param {object} [settings] guild settings document
 * @returns {((key: string, vars?: object) => string) & {locale: string}}
 */
function interactionTranslator(interaction, settings) {
  const locale = resolveLocale({
    setting: settings?.language,
    userLocale: interaction?.locale,
    guildLocale: interaction?.guild?.preferredLocale || interaction?.guildLocale,
  });
  const t = (key, vars) => translate(locale, key, vars);
  t.locale = locale;
  return t;
}

module.exports = {
  DEFAULT_LOCALE,
  LOCALES,
  LOCALE_LABELS,
  fromDiscordLocale,
  guildTranslator,
  interactionTranslator,
  resolveLocale,
  translate,
};
