const test = require("node:test");
const assert = require("node:assert/strict");
require("module-alias/register");

const { PRESETS, completionsURL, resolveProvider } = require("@src/services/ai/visionProvider");

test("nothing configured means no remote checks", () => {
  const provider = resolveProvider({});

  assert.equal(provider.configured, false);
  assert.equal(provider.apiKey, null);
});

test("a key alone is enough to pick the provider it belongs to", () => {
  assert.equal(resolveProvider({ IO_INTELLIGENCE_API_KEY: "k" }).name, "ionet");
  assert.equal(resolveProvider({ GEMINI_API_KEY: "k" }).name, "gemini");
  assert.equal(resolveProvider({ OPENROUTER_API_KEY: "k" }).name, "openrouter");
});

test("an explicit choice wins over which keys happen to exist", () => {
  const provider = resolveProvider({
    IO_INTELLIGENCE_API_KEY: "a",
    GEMINI_API_KEY: "b",
    IMAGE_AI_PROVIDER: "gemini",
  });

  assert.equal(provider.name, "gemini");
  assert.equal(provider.apiKey, "b", "the key of the chosen provider is used");
});

test("an unknown provider name falls back rather than breaking", () => {
  assert.equal(resolveProvider({ IMAGE_AI_PROVIDER: "nonsense" }).name, "ionet");
});

test("base URL and model can be overridden for any endpoint that speaks the same dialect", () => {
  const provider = resolveProvider({
    IMAGE_AI_BASE_URL: "https://example.com/v1/",
    IMAGE_AI_API_KEY: "k",
    IMAGE_AI_MODEL: "some-model",
  });

  assert.equal(provider.baseURL, "https://example.com/v1", "a trailing slash would double up in the path");
  assert.equal(provider.model, "some-model");
  assert.equal(provider.configured, true);
});

test("every preset points at a chat completions endpoint", () => {
  const env = { CLOUDFLARE_ACCOUNT_ID: "account" };

  for (const [name, preset] of Object.entries(PRESETS)) {
    const baseURL = typeof preset.baseURL === "function" ? preset.baseURL(env) : preset.baseURL;
    assert.match(baseURL, /^https:\/\//, `${name} must be https`);
    assert.doesNotMatch(baseURL, /\/$/, `${name} must not end in a slash`);
    assert.ok(preset.model, `${name} has no default model`);
    assert.ok(preset.keyEnv, `${name} has no key variable`);

    const url = completionsURL({ ...env, IMAGE_AI_PROVIDER: name });
    assert.equal(url, `${baseURL}/chat/completions`);
  }
});

/* ---------------------------------------------------------------- proxying */

const { proxyDispatcher } = require("@src/services/ai/visionProvider");

test("requests go direct unless a proxy is configured", () => {
  assert.equal(proxyDispatcher({}), undefined);
  assert.equal(proxyDispatcher({ IMAGE_AI_PROXY: "" }), undefined);
});

test("a configured proxy produces a dispatcher, reused between calls", () => {
  const first = proxyDispatcher({ IMAGE_AI_PROXY: "http://127.0.0.1:8080" });

  assert.ok(first, "a proxy URL must produce a dispatcher");
  assert.equal(proxyDispatcher({ IMAGE_AI_PROXY: "http://127.0.0.1:8080" }), first, "the agent is cached");
  assert.notEqual(
    proxyDispatcher({ IMAGE_AI_PROXY: "http://127.0.0.1:9090" }),
    first,
    "a different proxy gets its own agent"
  );
});

test("mistral is offered as a provider with a vision model", () => {
  const provider = resolveProvider({ MISTRAL_API_KEY: "k" });

  assert.equal(provider.name, "mistral");
  assert.match(provider.model, /pixtral/i, "the default must be able to read images");
});

test("cloudflare needs its account id, not just a token", () => {
  const withoutAccount = resolveProvider({ CLOUDFLARE_API_TOKEN: "t" });
  assert.equal(withoutAccount.name, "cloudflare");
  assert.equal(withoutAccount.configured, false, "an account-less URL would 404 on every image");
  assert.deepEqual(withoutAccount.missing, ["CLOUDFLARE_ACCOUNT_ID"]);

  const complete = resolveProvider({ CLOUDFLARE_API_TOKEN: "t", CLOUDFLARE_ACCOUNT_ID: "abc123" });
  assert.equal(complete.configured, true);
  assert.equal(complete.baseURL, "https://api.cloudflare.com/client/v4/accounts/abc123/ai/v1");
  assert.match(complete.model, /vision/i);
});
