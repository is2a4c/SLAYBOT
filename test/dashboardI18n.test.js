const test = require("node:test");
const assert = require("node:assert/strict");
require("module-alias/register");

const fs = require("fs");
const path = require("path");
const ejs = require("ejs");

const {
  COOKIE_NAME,
  DEFAULT_LOCALE,
  LOCALES,
  fromAcceptLanguage,
  localeMiddleware,
  resolveLocale,
  translate,
} = require("../dashboard/i18n");

const VIEWS_DIR = path.join(__dirname, "..", "dashboard", "views");

function flatten(dictionary, prefix = "") {
  return Object.entries(dictionary).flatMap(([key, value]) =>
    value && typeof value === "object" ? flatten(value, `${prefix}${key}.`) : [`${prefix}${key}`]
  );
}

test("every locale defines exactly the same keys", () => {
  const reference = flatten(LOCALES[DEFAULT_LOCALE]).sort();

  for (const [code, dictionary] of Object.entries(LOCALES)) {
    const keys = flatten(dictionary).sort();
    assert.deepEqual(keys, reference, `locale ${code} has a different key set`);
  }
});

test("no locale leaves a translation empty", () => {
  for (const [code, dictionary] of Object.entries(LOCALES)) {
    for (const key of flatten(dictionary)) {
      const value = translate(code, key);
      assert.ok(value && value !== key, `${code}.${key} is empty`);
    }
  }
});

test("placeholders are filled and unknown ones are left alone", () => {
  assert.equal(translate("en", "common.page", { page: 2, total: 5 }), "Page 2 / 5");
  assert.equal(translate("ru", "common.page", { page: 2, total: 5 }), "Стр. 2 / 5");
  assert.equal(translate("en", "common.page", { page: 2 }), "Page 2 / {total}");
});

test("a missing key falls back to the default locale and then to the key itself", () => {
  const original = LOCALES.en.common.save;
  delete LOCALES.en.common.save;

  try {
    assert.equal(translate("en", "common.save"), LOCALES.ru.common.save, "falls back to the default locale");
    assert.equal(translate("en", "nope.not.here"), "nope.not.here", "falls back to the key");
  } finally {
    LOCALES.en.common.save = original;
  }
});

test("Accept-Language is honoured by quality, ignoring unknown languages", () => {
  assert.equal(fromAcceptLanguage("en-GB,en;q=0.9,ru;q=0.8"), "en");
  assert.equal(fromAcceptLanguage("ru-RU,ru;q=0.9"), "ru");
  assert.equal(fromAcceptLanguage("de-DE,de;q=0.9,en;q=0.5"), "en");
  assert.equal(fromAcceptLanguage("de,fr"), null);
  assert.equal(fromAcceptLanguage(""), null);
});

test("an explicit ?lang wins over the cookie and is persisted", () => {
  assert.deepEqual(resolveLocale({ query: "en", cookie: "ru" }), { locale: "en", persist: true });
  assert.deepEqual(resolveLocale({ cookie: "en", acceptLanguage: "ru" }), { locale: "en", persist: false });
  assert.deepEqual(resolveLocale({ acceptLanguage: "en" }), { locale: "en", persist: false });
  assert.deepEqual(resolveLocale({}), { locale: DEFAULT_LOCALE, persist: false });
  assert.deepEqual(resolveLocale({ query: "klingon" }), { locale: DEFAULT_LOCALE, persist: false });
});

test("the middleware exposes t, the locale list and a date formatter", () => {
  const cookies = [];
  const res = { locals: {}, cookie: (name, value) => cookies.push([name, value]) };
  let called = false;

  localeMiddleware({ query: { lang: "en" }, headers: {} }, res, () => {
    called = true;
  });

  assert.ok(called);
  assert.equal(res.locals.locale, "en");
  assert.equal(res.locals.t("common.save"), "Save");
  assert.deepEqual(cookies, [[COOKIE_NAME, "en"]]);
  assert.deepEqual(
    res.locals.locales.map((entry) => entry.code),
    Object.keys(LOCALES)
  );
  assert.ok(res.locals.locales.find((entry) => entry.code === "en").active);
  assert.match(res.locals.formatDate("2026-07-30T12:00:00.000Z"), /2026/);
});

test("the middleware does not set a cookie when the language was not chosen explicitly", () => {
  const cookies = [];
  const res = { locals: {}, cookie: (name, value) => cookies.push([name, value]) };

  localeMiddleware({ query: {}, headers: { "accept-language": "en" } }, res, () => {});

  assert.equal(res.locals.locale, "en");
  assert.deepEqual(cookies, []);
});

test("no template carries a hardcoded Russian string any more", () => {
  const offenders = [];

  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.name.endsWith(".ejs")) continue;

      const content = fs.readFileSync(full, "utf8");
      const matches = content.match(/[А-Яа-яЁё]{3,}/g);
      if (matches) offenders.push(`${path.relative(VIEWS_DIR, full)}: ${matches.slice(0, 3).join(", ")}`);
    }
  };

  walk(VIEWS_DIR);
  assert.deepEqual(offenders, [], "templates must translate through t()");
});

test("the status page renders in both languages", () => {
  const report = {
    status: "operational",
    generatedAt: "2026-07-30T12:00:00.000Z",
    uptime: { seconds: 3600, human: "1h 0m", since: "2026-07-30T11:00:00.000Z" },
    components: [{ id: "gateway", name: "Discord gateway", status: "operational", detail: "42 ms" }],
    metrics: { guilds: 1, channels: 2, commands: 3, shards: 1, gatewayPingMs: 42, memoryMb: 120 },
    shards: [],
  };

  for (const locale of Object.keys(LOCALES)) {
    const html = ejs.render(
      fs.readFileSync(path.join(VIEWS_DIR, "status.ejs"), "utf8"),
      {
        title: translate(locale, "status.title"),
        report,
        basePath: "/dashboard",
        locale,
        locales: Object.keys(LOCALES).map((code) => ({ code, label: code, active: code === locale })),
        t: (key, vars) => translate(locale, key, vars),
        formatDate: (value) => new Date(value).toISOString(),
        csrfToken: "test",
        sessionUser: null,
        isOwnerUser: false,
      },
      { filename: path.join(VIEWS_DIR, "status.ejs") }
    );

    assert.match(html, new RegExp(translate(locale, "status.heading")));
    assert.match(html, new RegExp(translate(locale, "status.componentGateway")));
    assert.match(html, /status\.json/);
  }
});

function renderView(view, locals) {
  const locale = "en";
  return ejs.render(
    fs.readFileSync(path.join(VIEWS_DIR, view), "utf8"),
    {
      basePath: "/dashboard",
      locale,
      locales: [{ code: locale, label: "English", active: true }],
      t: (key, vars) => translate(locale, key, vars),
      formatDate: (value) => new Date(value).toISOString(),
      csrfToken: "test",
      sessionUser: { id: "1", username: "staff" },
      canAccessOwner: true,
      isOwnerUser: false,
      ...locals,
    },
    { filename: path.join(VIEWS_DIR, view) }
  );
}

test("guild navigation only renders links granted by the effective role", () => {
  const allowed = new Set(["guilds.view", "automod.edit", "diagnostics.run"]);
  const html = renderView("guild/overview.ejs", {
    title: "Guild",
    guild: { id: "100000000000000001", name: "Guild", memberCount: 1 },
    attention: [],
    counters: {
      members: 1,
      messages24h: 0,
      automodActions24h: 0,
      openTickets: 0,
      activeSmartInvites: 0,
      errors24h: 0,
    },
    canGuild: (permission) => allowed.has(permission),
    canGlobal: () => false,
  });

  assert.match(html, /\/automod/);
  assert.match(html, /\/diagnostics/);
  assert.doesNotMatch(html, /\/config/);
  assert.doesNotMatch(html, /\/smart-invites/);
});

test("owner dashboard hides staff and audit controls without their permissions", () => {
  const html = renderView("owner/index.ejs", {
    title: "Owner",
    periodDays: 1,
    summary: {
      counters: { commands: 0, automod_actions: 0, client_errors: 0 },
      activeUsers: 0,
      commandLatency: { averageMs: 0 },
    },
    guildCount: 0,
    guilds: [],
    canGuild: () => false,
    canGlobal: (permission) => permission === "guilds.view",
  });

  assert.doesNotMatch(html, /\/owner\/staff/);
  assert.doesNotMatch(html, /\/owner\/audit/);
});
