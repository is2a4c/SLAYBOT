const test = require("node:test");
const assert = require("node:assert/strict");
require("module-alias/register");

const {
  DEFAULT_LOCALE,
  LOCALES,
  guildTranslator,
  interactionTranslator,
  resolveLocale,
  translate,
} = require("@src/i18n");

/**
 * Every leaf key in a dictionary, dotted.
 * @param {object} dictionary
 * @param {string} [prefix]
 * @returns {string[]}
 */
function keysOf(dictionary, prefix = "") {
  return Object.entries(dictionary).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return value && typeof value === "object" ? keysOf(value, path) : [path];
  });
}

test("every locale carries the same keys", () => {
  const reference = keysOf(LOCALES[DEFAULT_LOCALE]).sort();

  for (const [code, dictionary] of Object.entries(LOCALES)) {
    assert.deepEqual(keysOf(dictionary).sort(), reference, `${code} does not match ${DEFAULT_LOCALE}`);
  }
});

test("no translation is left empty", () => {
  for (const [code, dictionary] of Object.entries(LOCALES)) {
    for (const key of keysOf(dictionary)) {
      assert.ok(translate(code, key).trim().length > 0, `${code}.${key} is empty`);
    }
  }
});

test("placeholders match between locales", () => {
  const placeholders = (text) => (String(text).match(/{(\w+)}/g) || []).sort();

  for (const key of keysOf(LOCALES[DEFAULT_LOCALE])) {
    const reference = placeholders(translate(DEFAULT_LOCALE, key));

    for (const code of Object.keys(LOCALES)) {
      assert.deepEqual(placeholders(translate(code, key)), reference, `${code}.${key} has different placeholders`);
    }
  }
});

/* ------------------------------------------------------------ locale choice */

test("an explicit server language wins over everything else", () => {
  assert.equal(resolveLocale({ setting: "en", userLocale: "ru", guildLocale: "ru" }), "en");
  assert.equal(resolveLocale({ setting: "ru", userLocale: "en-US", guildLocale: "en-US" }), "ru");
});

test("without a setting the reader's locale is used, then the server's", () => {
  assert.equal(resolveLocale({ userLocale: "ru", guildLocale: "en-US" }), "ru");
  assert.equal(resolveLocale({ guildLocale: "ru" }), "ru");
  assert.equal(resolveLocale({ guildLocale: "en-GB" }), "en");
});

test("unknown locales fall back to the default", () => {
  assert.equal(resolveLocale({ setting: "klingon", guildLocale: "de" }), DEFAULT_LOCALE);
  assert.equal(resolveLocale({}), DEFAULT_LOCALE);
  assert.equal(resolveLocale(), DEFAULT_LOCALE);
});

/* --------------------------------------------------------------- rendering */

test("placeholders are filled in and unknown ones are left alone", () => {
  assert.equal(translate("ru", "tempvoice.results.renamed", { name: "Лобби" }), "Канал переименован в **Лобби**.");
  assert.equal(translate("en", "tempvoice.results.limitSet", { limit: 4 }), "Member limit: **4**.");
  assert.match(translate("en", "tempvoice.results.renamed"), /{name}/);
});

test("a missing key degrades to the default locale and then to the key itself", () => {
  assert.equal(translate("ru", "definitely.not.a.key"), "definitely.not.a.key");
  assert.equal(translate("klingon", "common.enabled"), translate(DEFAULT_LOCALE, "common.enabled"));
});

/* -------------------------------------------------------------- translators */

test("the guild translator ignores who is reading", () => {
  const t = guildTranslator({ language: "ru" }, { preferredLocale: "en-US" });

  assert.equal(t.locale, "ru");
  assert.equal(t("common.enabled"), "включено");
});

test("the interaction translator follows the clicker until a server pins a language", () => {
  const interaction = { locale: "ru", guild: { preferredLocale: "en-US" } };

  assert.equal(interactionTranslator(interaction, {}).locale, "ru");
  assert.equal(interactionTranslator(interaction, { language: "en" }).locale, "en");
});
