require("module-alias/register");

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const { launch } = require("../dashboard/app");

let mongo;
let server;
let port;

function get(urlPath, headers = {}) {
  return new Promise((resolve, reject) => {
    http
      .get({ host: "127.0.0.1", port, path: urlPath, headers }, (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve({ statusCode: res.statusCode, headers: res.headers, body }));
      })
      .on("error", reject);
  });
}

test.before(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGO_CONNECTION = mongo.getUri();
  process.env.SESSION_PASSWORD = "test-session-password-123456";
  process.env.BOT_SECRET = "test-bot-secret";

  const fakeClient = {
    config: {
      DASHBOARD: {
        enabled: true,
        baseURL: "https://slaybot.televibe.host/dashboard",
        failureURL: "https://slaybot.televibe.host/dashboard",
        port: 0,
        trustProxy: false,
      },
      OWNER_IDS: ["1223236439345463367"],
      SMART_INVITES: { enabled: false },
    },
    guilds: { cache: new Map() },
    user: { id: "999999999999999999" },
    logger: { success: () => {}, error: () => {}, warn: () => {}, log: () => {}, debug: () => {} },
  };

  ({ server } = await launch(fakeClient));
  port = server.address().port;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
  await mongo.stop();
});

// Regression test: the app is mounted at the process root (an external reverse
// proxy strips the /dashboard prefix before forwarding - see dashboard/app.js),
// while every link/redirect the app generates for the browser still carries
// that prefix. A previous version set the session cookie's `path` to that same
// public prefix, which broke express-session entirely for root-mounted
// requests - it silently left req.session undefined instead of erroring,
// which then crashed on the first `req.session.x` access. Session cookie path
// must stay "/" here, matching what the app actually receives.
test("root request redirects to the prefixed login URL without creating an anonymous session", async () => {
  const res = await get("/");
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.location, "/dashboard/auth/login?redirect=%2F");
  assert.equal(res.headers["set-cookie"], undefined);
});

test("OAuth login creates its state session with a Path=/ cookie", async () => {
  const res = await get("/auth/login");
  assert.equal(res.statusCode, 302);
  assert.match(res.headers.location, /^https:\/\/discord\.com\/api\/v10\/oauth2\/authorize\?/);

  const cookieHeader = res.headers["set-cookie"]?.join(";") ?? "";
  assert.match(cookieHeader, /slaybot_dashboard_sid=/);
  assert.match(cookieHeader, /Path=\//);
  assert.doesNotMatch(cookieHeader, /Path=\/dashboard/);
});

test("static assets are served under the internal (unprefixed) path", async () => {
  const res = await get("/style.css");
  assert.equal(res.statusCode, 200);
});

test("the machine-readable status endpoint is available at the documented top-level path", async () => {
  const res = await get("/status.json");
  assert.equal(res.statusCode, 503);
  assert.match(res.headers["content-type"], /^application\/json/);
  assert.equal(JSON.parse(res.body).status, "outage");
  assert.equal(res.headers["set-cookie"], undefined);
});

test("an unknown path renders the 404 page instead of throwing", async () => {
  const res = await get("/this-does-not-exist");
  assert.equal(res.statusCode, 404);
  assert.match(res.body, /Не найдено/);
});

// Safari enforces form-action against the OAuth redirect target itself (not
// just actual <form> submissions, more aggressively than the spec), so
// discord.com must be explicitly allowed or the login button 404s there.
test("CSP form-action allows discord.com so the OAuth redirect isn't blocked in Safari", async () => {
  const res = await get("/");
  assert.match(res.headers["content-security-policy"], /form-action[^;]*\bhttps:\/\/discord\.com\b/);
});
