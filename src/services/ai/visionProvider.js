/**
 * Which OpenAI-compatible endpoint the image checks talk to.
 *
 * Several providers speak the same chat-completions dialect, including the same
 * `image_url` with a data: URI, so switching between them is a base URL, a key
 * and a model name. Presets exist for the ones worth naming; anything else can
 * be pointed at with IMAGE_AI_BASE_URL.
 */

const PRESETS = {
  ionet: {
    label: "io.net",
    baseURL: "https://api.intelligence.io.solutions/api/v1",
    model: "meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8",
    keyEnv: "IO_INTELLIGENCE_API_KEY",
  },
  gemini: {
    label: "Google Gemini",
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
    model: "gemini-3.6-flash",
    keyEnv: "GEMINI_API_KEY",
  },
  openrouter: {
    label: "OpenRouter",
    baseURL: "https://openrouter.ai/api/v1",
    model: "google/gemma-4-26b-a4b-it:free",
    keyEnv: "OPENROUTER_API_KEY",
  },
  mistral: {
    label: "Mistral",
    baseURL: "https://api.mistral.ai/v1",
    model: "pixtral-12b-2409",
    keyEnv: "MISTRAL_API_KEY",
  },
  cloudflare: {
    label: "Cloudflare Workers AI",
    // The account id is part of the path rather than a header.
    baseURL: (env) => `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID || ""}/ai/v1`,
    model: "@cf/meta/llama-3.2-11b-vision-instruct",
    keyEnv: "CLOUDFLARE_API_TOKEN",
    // Without the account there is nowhere to send the request.
    requires: ["CLOUDFLARE_ACCOUNT_ID"],
  },
};

let proxyAgent;
let proxyAgentFor;

/**
 * Dispatcher for the provider request, if a proxy is configured.
 *
 * Some providers refuse the request itself based on where it comes from —
 * Gemini answers "User location is not supported" to an otherwise valid key —
 * so the way out is routing these calls through somewhere they accept.
 *
 * @param {object} [env]
 * @returns {object|undefined}
 */
function proxyDispatcher(env = process.env) {
  const url = env.IMAGE_AI_PROXY;
  if (!url) return undefined;

  if (proxyAgentFor !== url) {
    const { ProxyAgent } = require("undici");
    proxyAgent = new ProxyAgent(url);
    proxyAgentFor = url;
  }

  return proxyAgent;
}

/**
 * Work out the provider in force.
 *
 * An explicit IMAGE_AI_PROVIDER wins. Otherwise whichever provider has a key
 * configured is used, so adding GEMINI_API_KEY is enough to switch.
 *
 * @param {object} [env]
 * @returns {{name: string, label: string, baseURL: string, model: string, apiKey: string|null, configured: boolean}}
 */
function resolveProvider(env = process.env) {
  const requested = String(env.IMAGE_AI_PROVIDER || "").toLowerCase();
  const name = PRESETS[requested] ? requested : Object.keys(PRESETS).find((key) => env[PRESETS[key].keyEnv]) || "ionet";
  const preset = PRESETS[name];

  const apiKey = env.IMAGE_AI_API_KEY || env[preset.keyEnv] || null;
  const preseUrl = typeof preset.baseURL === "function" ? preset.baseURL(env) : preset.baseURL;
  const baseURL = (env.IMAGE_AI_BASE_URL || preseUrl).replace(/\/+$/, "");
  const missing = (preset.requires || []).filter((variable) => !env[variable] && !env.IMAGE_AI_BASE_URL);

  return {
    name,
    label: preset.label,
    baseURL,
    model: env.IMAGE_AI_MODEL || preset.model,
    apiKey,
    missing,
    configured: Boolean(apiKey) && missing.length === 0,
  };
}

/**
 * @param {object} [env]
 * @returns {string} the chat completions endpoint
 */
function completionsURL(env = process.env) {
  return `${resolveProvider(env).baseURL}/chat/completions`;
}

module.exports = { PRESETS, completionsURL, proxyDispatcher, resolveProvider };
