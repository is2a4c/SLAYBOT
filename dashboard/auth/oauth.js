const DISCORD_API = "https://discord.com/api/v10";

/**
 * Builds the Discord OAuth2 authorize URL. `clientId` is the bot's own
 * application id (`client.user.id`), which is also the OAuth2 client id.
 */
function buildAuthorizeURL({ clientId, redirectUri, state }) {
  const params = new URLSearchParams({
    client_id: clientId,
    scope: "identify guilds",
    response_type: "code",
    redirect_uri: redirectUri,
    state,
  });
  return `${DISCORD_API}/oauth2/authorize?${params.toString()}`;
}

/**
 * Exchanges an authorization code for an access token.
 * `clientSecret` is the Discord application's OAuth2 Client Secret (env `BOT_SECRET`),
 * not the bot token. The refresh token is intentionally discarded - if the access
 * token expires the user simply logs in again, so no long-lived secret sits in the
 * session store.
 * @param {object} opts
 * @param {typeof fetch} [opts.fetchImpl]
 */
async function exchangeCode({ code, clientId, clientSecret, redirectUri, fetchImpl = require("node-fetch") }) {
  const params = new URLSearchParams();
  params.set("grant_type", "authorization_code");
  params.set("code", code);
  params.set("redirect_uri", redirectUri);
  params.set("client_id", clientId);
  params.set("client_secret", clientSecret);

  const response = await fetchImpl(`${DISCORD_API}/oauth2/token`, {
    method: "POST",
    body: params.toString(),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) {
    const error = new Error(data.error_description || data.error || "Discord token exchange failed");
    error.discordResponse = data;
    throw error;
  }
  return { accessToken: data.access_token, tokenType: data.token_type, expiresIn: data.expires_in };
}

async function fetchDiscordUser({ accessToken, fetchImpl = require("node-fetch") }) {
  const response = await fetchImpl(`${DISCORD_API}/users/@me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || "Failed to fetch Discord user profile");
  return data;
}

async function fetchDiscordGuilds({ accessToken, fetchImpl = require("node-fetch") }) {
  const response = await fetchImpl(`${DISCORD_API}/users/@me/guilds`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || "Failed to fetch Discord guild list");
  return Array.isArray(data) ? data : [];
}

module.exports = { buildAuthorizeURL, exchangeCode, fetchDiscordUser, fetchDiscordGuilds };
