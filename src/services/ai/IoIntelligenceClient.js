const DEFAULT_ENDPOINT = "https://api.intelligence.io.solutions/api/v1/chat/completions";
const DEFAULT_MODELS_ENDPOINT = "https://api.intelligence.io.solutions/api/v1/models";
const DEFAULT_MODEL = "meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8";

class AiError extends Error {
  constructor(code, message, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = "AiError";
    this.code = code;
  }
}

function parsePositiveInt(value, fallback, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

function clamp(value, min, max, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function extractJson(content) {
  const text = String(content || "").trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() || text;

  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1));
      } catch {
        // fall through to the stable public error below
      }
    }
    throw new AiError("AI_INVALID_RESPONSE", "AI returned invalid structured output");
  }
}

class IoIntelligenceClient {
  constructor(options = {}) {
    this.apiKey = options.apiKey ?? process.env.IO_INTELLIGENCE_API_KEY ?? "";
    this.endpoint = options.endpoint || process.env.IO_INTELLIGENCE_API_URL || DEFAULT_ENDPOINT;
    this.modelsEndpoint = options.modelsEndpoint || process.env.IO_INTELLIGENCE_MODELS_URL || DEFAULT_MODELS_ENDPOINT;
    this.model = options.model || process.env.IO_INTELLIGENCE_MODEL || DEFAULT_MODEL;
    this.fetchImpl = options.fetchImpl || global.fetch;
    this.timeoutMs = options.timeoutMs ?? parsePositiveInt(process.env.IO_INTELLIGENCE_TIMEOUT_MS, 30_000, 120_000);
    this.maxConcurrency = options.maxConcurrency ?? parsePositiveInt(process.env.IO_INTELLIGENCE_CONCURRENCY, 2, 8);
    this.callsPerMinute =
      options.callsPerMinute ?? parsePositiveInt(process.env.IO_INTELLIGENCE_CALLS_PER_MINUTE, 20, 600);
    this.maxSystemChars = options.maxSystemChars ?? 12_000;
    this.maxUserChars = options.maxUserChars ?? 24_000;
    this.active = 0;
    this.waiters = [];
    this.guildCalls = new Map();
  }

  isConfigured() {
    return Boolean(this.apiKey);
  }

  assertRateLimit(guildId, now = Date.now()) {
    if (!guildId) return;
    const windowStart = now - 60_000;
    const recent = (this.guildCalls.get(guildId) || []).filter((timestamp) => timestamp > windowStart);
    if (recent.length >= this.callsPerMinute) {
      this.guildCalls.set(guildId, recent);
      throw new AiError("AI_RATE_LIMITED", "AI request budget exceeded for this server");
    }
    recent.push(now);
    this.guildCalls.set(guildId, recent);
  }

  async acquire() {
    if (this.active < this.maxConcurrency) {
      this.active += 1;
      return;
    }
    await new Promise((resolve) => this.waiters.push(resolve));
    this.active += 1;
  }

  release() {
    this.active = Math.max(0, this.active - 1);
    this.waiters.shift()?.();
  }

  async complete({ system, user, maxTokens = 400, temperature = 0, model = this.model, guildId }) {
    if (!this.isConfigured()) {
      throw new AiError("AI_NOT_CONFIGURED", "AI service is not configured");
    }
    if (typeof this.fetchImpl !== "function") {
      throw new AiError("AI_UNAVAILABLE", "AI transport is unavailable");
    }

    const boundedSystem = String(system || "")
      .trim()
      .slice(0, this.maxSystemChars);
    const boundedUser = String(user || "")
      .trim()
      .slice(0, this.maxUserChars);
    if (!boundedSystem || !boundedUser) {
      throw new AiError("AI_INVALID_INPUT", "AI system and user input are required");
    }

    this.assertRateLimit(guildId);
    await this.acquire();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: boundedSystem },
            { role: "user", content: boundedUser },
          ],
          temperature: clamp(temperature, 0, 1, 0),
          max_tokens: parsePositiveInt(maxTokens, 400, 1200),
        }),
        signal: controller.signal,
      });

      if (!response?.ok) {
        const status = Number(response?.status) || 500;
        throw new AiError("AI_HTTP_ERROR", `AI provider returned HTTP ${status}`);
      }

      const payload = await response.json();
      const content = payload?.choices?.[0]?.message?.content;
      if (typeof content !== "string" || !content.trim()) {
        throw new AiError("AI_INVALID_RESPONSE", "AI provider returned an invalid response");
      }

      return {
        content: content.trim(),
        model: String(payload.model || model),
      };
    } catch (error) {
      if (error instanceof AiError) throw error;
      if (error?.name === "AbortError") {
        throw new AiError("AI_TIMEOUT", `AI request timed out after ${this.timeoutMs} ms`, error);
      }
      throw new AiError("AI_UNAVAILABLE", "AI provider request failed", error);
    } finally {
      clearTimeout(timeout);
      this.release();
    }
  }

  async completeJson(input) {
    const result = await this.complete(input);
    return extractJson(result.content);
  }

  async listModels({ page = 1, pageSize = 100, query } = {}) {
    if (!this.isConfigured()) {
      throw new AiError("AI_NOT_CONFIGURED", "AI service is not configured");
    }
    if (typeof this.fetchImpl !== "function") {
      throw new AiError("AI_UNAVAILABLE", "AI transport is unavailable");
    }

    const params = new URLSearchParams({
      page: String(parsePositiveInt(page, 1)),
      page_size: String(parsePositiveInt(pageSize, 100, 100)),
    });
    if (query) params.set("q", String(query).slice(0, 200));

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.modelsEndpoint}?${params}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: controller.signal,
      });
      if (!response?.ok) {
        const status = Number(response?.status) || 500;
        throw new AiError("AI_HTTP_ERROR", `AI provider returned HTTP ${status}`);
      }
      const payload = await response.json();
      if (!Array.isArray(payload?.data)) {
        throw new AiError("AI_INVALID_RESPONSE", "AI provider returned an invalid models response");
      }
      return {
        data: payload.data,
        pagination: payload.pagination || null,
      };
    } catch (error) {
      if (error instanceof AiError) throw error;
      if (error?.name === "AbortError") {
        throw new AiError("AI_TIMEOUT", `AI request timed out after ${this.timeoutMs} ms`, error);
      }
      throw new AiError("AI_UNAVAILABLE", "AI provider request failed", error);
    } finally {
      clearTimeout(timeout);
    }
  }

  async checkConfiguredModel() {
    const { data } = await this.listModels({ page: 1, pageSize: 100, query: this.model });
    const model = data.find((entry) => entry?.name === this.model);
    return {
      model: this.model,
      available: Boolean(model),
      chatCompletions: Boolean(model?.metadata?.enable_api_chat_completions),
      supportsImages: Boolean(model?.metadata?.supports_images_input),
      contextWindow: Number(model?.metadata?.context_window) || null,
    };
  }
}

let defaultClient;

function getIoIntelligenceClient() {
  if (!defaultClient) defaultClient = new IoIntelligenceClient();
  return defaultClient;
}

module.exports = {
  AiError,
  IoIntelligenceClient,
  DEFAULT_ENDPOINT,
  DEFAULT_MODELS_ENDPOINT,
  DEFAULT_MODEL,
  extractJson,
  getIoIntelligenceClient,
};
