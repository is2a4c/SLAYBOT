const test = require("node:test");
const assert = require("node:assert/strict");

require("module-alias/register");

const { IoIntelligenceClient } = require("../src/services/ai/IoIntelligenceClient");
const { AiService } = require("../src/services/ai/AiService");
const { inspectTextRisk } = require("../src/handlers/automod");
const { analyzeFormResponseSafely } = require("../src/handlers/form");
const aiCommand = require("../src/commands/admin/ai");
const askCommand = require("../src/commands/utility/ask");
const ticketCommand = require("../src/commands/ticket/ticket");
const suggestCommand = require("../src/commands/suggestions/suggest");
const { ChannelType } = require("discord.js");

function jsonResponse(content, model = "test-model") {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      model,
      choices: [{ message: { content } }],
    }),
  };
}

test("io.net client fails without exposing or requiring a credential", async () => {
  const client = new IoIntelligenceClient({
    apiKey: "",
    fetchImpl: async () => assert.fail("fetch must not run"),
  });

  await assert.rejects(
    client.complete({ system: "system", user: "user" }),
    (error) => error.code === "AI_NOT_CONFIGURED" && !error.message.includes("Bearer")
  );
});

test("io.net client parses fenced structured output and bounds input", async () => {
  let request;
  const client = new IoIntelligenceClient({
    apiKey: "test-secret",
    maxSystemChars: 20,
    maxUserChars: 24,
    fetchImpl: async (url, options) => {
      request = { url, options, body: JSON.parse(options.body) };
      return jsonResponse('```json\n{"risky":true,"score":91}\n```');
    },
  });

  const result = await client.completeJson({
    system: "s".repeat(50),
    user: "u".repeat(50),
    guildId: "guild-1",
  });

  assert.deepEqual(result, { risky: true, score: 91 });
  assert.equal(request.body.messages[0].content.length, 20);
  assert.equal(request.body.messages[1].content.length, 24);
  assert.equal(request.options.headers.Authorization, "Bearer test-secret");
});

test("io.net client discovers and verifies configured chat models", async () => {
  let request;
  const client = new IoIntelligenceClient({
    apiKey: "test-secret",
    model: "chat-model",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            {
              name: "chat-model",
              metadata: {
                enable_api_chat_completions: true,
                supports_images_input: false,
              },
            },
          ],
          pagination: { total: 1, page: 1, page_size: 100, total_pages: 1 },
        }),
      };
    },
  });

  const result = await client.checkConfiguredModel();

  assert.match(request.url, /\/api\/v1\/models\?page=1&page_size=100&q=chat-model$/);
  assert.equal(request.options.method, "GET");
  assert.equal(result.available, true);
  assert.equal(result.chatCompletions, true);
});

test("io.net client enforces a per-guild call budget", async () => {
  const client = new IoIntelligenceClient({
    apiKey: "test-secret",
    callsPerMinute: 1,
    fetchImpl: async () => jsonResponse("ok"),
  });

  await client.complete({ system: "system", user: "first", guildId: "guild-1" });
  await assert.rejects(
    client.complete({ system: "system", user: "second", guildId: "guild-1" }),
    (error) => error.code === "AI_RATE_LIMITED"
  );
  assert.equal((await client.complete({ system: "system", user: "other guild", guildId: "guild-2" })).content, "ok");
});

test("io.net client bounds concurrency and aborts a stalled request", async () => {
  let active = 0;
  let maximum = 0;
  const concurrent = new IoIntelligenceClient({
    apiKey: "test-secret",
    maxConcurrency: 2,
    fetchImpl: async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return jsonResponse("ok");
    },
  });
  await Promise.all(
    Array.from({ length: 5 }, (_, index) =>
      concurrent.complete({ system: "system", user: String(index), guildId: `guild-${index}` })
    )
  );
  assert.equal(maximum, 2);

  const stalled = new IoIntelligenceClient({
    apiKey: "test-secret",
    timeoutMs: 5,
    fetchImpl: async (_url, options) =>
      new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      }),
  });
  await assert.rejects(stalled.complete({ system: "system", user: "stall" }), (error) => error.code === "AI_TIMEOUT");
});

test("AI service normalizes semantic moderation output", async () => {
  const service = new AiService({
    client: {
      completeJson: async () => ({
        risky: true,
        score: 140,
        category: "scam",
        reason: "r".repeat(900),
      }),
    },
  });

  const result = await service.moderateText({ content: "send money", guildId: "guild-1" });

  assert.equal(result.risky, true);
  assert.equal(result.score, 100);
  assert.equal(result.category, "SCAM");
  assert.equal(result.reason.length, 500);
});

test("knowledge answers are explicitly grounded and bounded", async () => {
  let request;
  const service = new AiService({
    client: {
      completeJson: async (input) => {
        request = input;
        return { answered: true, answer: "Use /verify" };
      },
    },
  });

  const result = await service.answerFromKnowledge({
    guildId: "guild-1",
    knowledge: "Verification requires /verify.",
    question: "How do I verify?",
  });

  assert.equal(result.answer, "Use /verify");
  assert.match(request.system, /only/i);
  assert.match(request.user, /Verification requires/);
  assert.match(request.user, /How do I verify/);
});

test("form analysis returns assistance without an outcome decision", async () => {
  const service = new AiService({
    client: {
      completeJson: async () => ({
        summary: "Experienced support applicant.",
        followUpQuestions: "Which timezone can you cover?",
        decision: "ACCEPT",
        score: 99,
      }),
    },
  });

  const result = await service.analyzeFormResponse({
    guildId: "guild-1",
    formTitle: "Staff application",
    answers: [{ question: "Experience", answer: "Two years" }],
  });

  assert.deepEqual(result, {
    summary: "Experienced support applicant.",
    followUpQuestions: "Which timezone can you cover?",
  });
  assert.equal("decision" in result, false);
  assert.equal("score" in result, false);
});

test("text moderation shadow mode logs risk without enforcement", async () => {
  const result = await inspectTextRisk(
    { content: "suspicious", guildId: "guild-1" },
    { enabled: true, automod_enabled: true, automod_mode: "SHADOW", automod_threshold: 85 },
    async () => ({ risky: true, score: 92, category: "SCAM", reason: "payment bait" })
  );

  assert.equal(result.shadowTriggered, true);
  assert.equal(result.shouldDelete, false);
  assert.equal(result.strikes, 0);
  assert.match(result.fields[0].value, /SCAM/);
});

test("text moderation enforce mode produces exactly one strike", async () => {
  const result = await inspectTextRisk(
    { content: "suspicious", guildId: "guild-1" },
    { enabled: true, automod_enabled: true, automod_mode: "ENFORCE", automod_threshold: 85 },
    async () => ({ risky: true, score: 92, category: "SCAM", reason: "payment bait" })
  );

  assert.equal(result.shadowTriggered, false);
  assert.equal(result.shouldDelete, true);
  assert.equal(result.strikes, 1);
});

test("ticket summary is on-demand, bounded, and does not mutate the channel", async () => {
  let transcript;
  const channel = {
    id: "ticket-1",
    guildId: "guild-1",
    type: ChannelType.GuildText,
    name: "tіcket-1",
    topic: "tіcket|owner-1|Billing",
    client: { logger: { warn: () => assert.fail("unexpected warning") } },
    messages: {
      fetch: async () =>
        new Map([
          [
            "message-1",
            {
              cleanContent: "My payment is missing",
              attachments: new Map(),
              createdAt: new Date("2026-07-29T10:00:00Z"),
              author: { username: "member" },
            },
          ],
        ]),
    },
  };
  const service = {
    isConfigured: () => true,
    summarizeTicket: async (input) => {
      transcript = input.transcript;
      return {
        summary: "Payment was not credited.",
        category: "Billing",
        urgency: "HIGH",
        nextStep: "Check transaction ID.",
      };
    },
  };

  const result = await ticketCommand.summarizeTicket(
    channel,
    { ai: { enabled: true, ticket_summaries: true } },
    service
  );

  assert.match(transcript, /payment is missing/i);
  assert.equal(result.embeds.length, 1);
  assert.equal(channel.name, "tіcket-1");
});

test("suggestion and form AI failures preserve their parent workflows", async () => {
  const warnings = [];
  const member = {
    guild: { id: "guild-1" },
    client: { logger: { warn: (message) => warnings.push(message) } },
  };
  const failingService = {
    isConfigured: () => true,
    analyzeSuggestion: async () => {
      throw new Error("provider down");
    },
    analyzeFormResponse: async () => {
      throw new Error("provider down");
    },
  };

  assert.equal(
    await suggestCommand.analyzeSuggestionSafely(
      member,
      "Add a channel",
      { ai: { enabled: true, suggestion_analysis: true } },
      failingService
    ),
    null
  );
  assert.equal(
    await analyzeFormResponseSafely(
      { guildId: "guild-1", client: member.client },
      { title: "Application" },
      [{ question: "Why?", answer: "To help" }],
      { ai: { enabled: true, form_analysis: true } },
      failingService
    ),
    null
  );
  assert.equal(warnings.length, 2);
});

test("AI commands expose safe configuration, grounded Q&A, and ticket summaries", () => {
  assert.deepEqual(aiCommand.userPermissions, ["ManageGuild"]);
  assert.equal(aiCommand.slashCommand.ephemeral, true);
  assert.ok(aiCommand.slashCommand.options.some((option) => option.name === "automod"));
  assert.ok(aiCommand.slashCommand.options.some((option) => option.name === "knowledge-set"));
  assert.ok(aiCommand.slashCommand.options.some((option) => option.name === "forms"));
  assert.equal(askCommand.name, "ask");
  assert.equal(askCommand.cooldown > 0, true);
  assert.ok(ticketCommand.slashCommand.options.some((option) => option.name === "summary"));
});
