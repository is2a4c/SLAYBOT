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
  for (const [name, preset] of Object.entries(PRESETS)) {
    assert.match(preset.baseURL, /^https:\/\//, `${name} must be https`);
    assert.doesNotMatch(preset.baseURL, /\/$/, `${name} must not end in a slash`);
    assert.ok(preset.model, `${name} has no default model`);
    assert.ok(preset.keyEnv, `${name} has no key variable`);

    const url = completionsURL({ IMAGE_AI_PROVIDER: name });
    assert.equal(url, `${preset.baseURL}/chat/completions`);
  }
});
