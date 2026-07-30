require("module-alias/register");

const test = require("node:test");
const assert = require("node:assert/strict");

const { buildAuthorizeURL, exchangeCode, fetchDiscordUser, fetchDiscordGuilds } = require("../dashboard/auth/oauth");
const { createState, consumeState, sanitizeRedirectPath } = require("../dashboard/auth/state");

function fakeSession() {
  return {};
}

test("buildAuthorizeURL encodes client id, redirect uri, and state with the identify+guilds scope", () => {
  const url = buildAuthorizeURL({
    clientId: "111111111111111111",
    redirectUri: "https://dash.example.com/auth/callback",
    state: "abc123",
  });
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get("client_id"), "111111111111111111");
  assert.equal(parsed.searchParams.get("scope"), "identify guilds");
  assert.equal(parsed.searchParams.get("response_type"), "code");
  assert.equal(parsed.searchParams.get("redirect_uri"), "https://dash.example.com/auth/callback");
  assert.equal(parsed.searchParams.get("state"), "abc123");
});

test("sanitizeRedirectPath only allows relative paths under known prefixes", () => {
  assert.equal(sanitizeRedirectPath("/g/123456789012345678"), "/g/123456789012345678");
  assert.equal(sanitizeRedirectPath("/owner/staff"), "/owner/staff");
  assert.equal(sanitizeRedirectPath("/"), "/");
  assert.equal(sanitizeRedirectPath("//evil.com"), "/");
  assert.equal(sanitizeRedirectPath("https://evil.com"), "/");
  assert.equal(sanitizeRedirectPath("/random"), "/");
  assert.equal(sanitizeRedirectPath(null), "/");
});

test("createState/consumeState round-trips once, rejects a wrong token, and is single-use", () => {
  // A wrong token against a valid, unexpired state must fail - and the state is
  // still consumed (cleared) so it can't be brute-forced across requests.
  const reqA = { session: fakeSession() };
  createState(reqA, "/g/123456789012345678");
  assert.equal(consumeState(reqA, "not-the-real-token-at-all-xxxx"), null);
  assert.equal(reqA.session.oauthState, null);

  // The correct token succeeds exactly once.
  const reqB = { session: fakeSession() };
  const token = createState(reqB, "/g/123456789012345678");
  assert.equal(consumeState(reqB, token), "/g/123456789012345678");
  assert.equal(consumeState(reqB, token), null);
});

test("consumeState rejects expired state", () => {
  const req = { session: fakeSession() };
  createState(req, "/");
  req.session.oauthState.expiresAt = Date.now() - 1000;
  assert.equal(consumeState(req, req.session.oauthState.value), null);
});

test("exchangeCode posts the authorization code and returns the access token", async () => {
  let capturedBody;
  let capturedUrl;
  const fetchImpl = async (url, options) => {
    capturedUrl = url;
    capturedBody = options.body;
    return { ok: true, json: async () => ({ access_token: "tok", token_type: "Bearer", expires_in: 604800 }) };
  };

  const result = await exchangeCode({
    code: "the-code",
    clientId: "111111111111111111",
    clientSecret: "shh",
    redirectUri: "https://dash.example.com/auth/callback",
    fetchImpl,
  });

  assert.equal(result.accessToken, "tok");
  assert.match(capturedUrl, /\/oauth2\/token$/);
  assert.match(capturedBody, /grant_type=authorization_code/);
  assert.match(capturedBody, /code=the-code/);
});

test("exchangeCode throws on a Discord error response", async () => {
  const fetchImpl = async () => ({ ok: false, json: async () => ({ error: "invalid_grant" }) });
  await assert.rejects(
    exchangeCode({ code: "bad", clientId: "1", clientSecret: "s", redirectUri: "https://x", fetchImpl }),
    /invalid_grant/
  );
});

test("fetchDiscordUser and fetchDiscordGuilds pass the bearer token through", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, auth: options.headers.Authorization });
    if (url.endsWith("/users/@me")) return { ok: true, json: async () => ({ id: "42", username: "isaac" }) };
    return { ok: true, json: async () => [{ id: "g1", name: "Guild One" }] };
  };

  const user = await fetchDiscordUser({ accessToken: "tok", fetchImpl });
  const guilds = await fetchDiscordGuilds({ accessToken: "tok", fetchImpl });

  assert.equal(user.username, "isaac");
  assert.equal(guilds.length, 1);
  assert.ok(calls.every((c) => c.auth === "Bearer tok"));
});
