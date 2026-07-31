# Spec: io.net AI integration

**Author:** is2a4c  
**Date:** 2026-07-29  
**Status:** Approved  
**Reviewer:** Project owner  
**Approval:** The project owner explicitly requested implementation after reviewing the proposed AI integration areas.

## Context

Slaybot already uses OCR and a vision-language model to detect image-based financial spam. The remote vision path already calls the io.net Chat Completions API, but the implementation is embedded in the image classifier and cannot be reused for text moderation, ticket assistance, server knowledge, or suggestion analysis.

The project owner requested a shared AI layer and approved four initial uses: semantic text moderation, ticket summaries, grounded server Q&A, and suggestion analysis. These capabilities must remain optional per guild, must not make irreversible staff decisions, and must not break existing behavior when io.net is unavailable.

## Functional Requirements

- FR-1: The system MUST expose a reusable io.net Chat Completions client configured only through environment variables.
- FR-2: The client MUST support bounded text completions and structured JSON completions.
- FR-3: The client MUST reject calls when no API key is configured without including the key in errors or logs.
- FR-4: Guild administrators MUST be able to view and configure AI feature flags through an `ai` command.
- FR-5: Semantic text moderation MUST be disabled by default.
- FR-6: Semantic text moderation MUST support `SHADOW` and `ENFORCE` modes.
- FR-7: In `SHADOW` mode, a risky AI result MUST be logged for moderators and MUST NOT delete the message, add strikes, or trigger a punishment.
- FR-8: In `ENFORCE` mode, a risky result at or above the configured threshold MUST use the existing AutoMod deletion and strike pipeline.
- FR-9: AI failures MUST NOT block normal message processing or existing deterministic AutoMod checks.
- FR-10: Configured ticket support staff MUST be able to request an AI summary from an open ticket.
- FR-11: Ticket summaries MUST be generated on demand and MUST NOT close tickets, change permissions, or perform moderation actions.
- FR-12: Users MUST be able to ask questions through an `ask` command when guild knowledge is configured.
- FR-13: Knowledge answers MUST be instructed to use only the configured guild knowledge and MUST report when the answer is absent.
- FR-14: Guild administrators MUST be able to replace or clear the guild knowledge text.
- FR-15: Suggestion analysis MUST be optional and MUST annotate a submitted suggestion without approving, rejecting, or deleting it.
- FR-16: Existing suggestion submission MUST succeed when AI analysis fails.
- FR-17: AI inputs and outputs MUST be length-bounded before API transmission and Discord rendering.
- FR-18: Existing image-spam behavior MUST continue to use the same io.net API key and remain backward compatible.
- FR-19: Form response analysis MUST be optional and MUST add only a neutral summary and follow-up questions.
- FR-20: Form response analysis MUST NOT accept, reject, score, rank, or otherwise decide an application outcome.
- FR-21: Existing form submission and persistence MUST succeed when AI analysis fails.
- FR-22: Operators MUST be able to query io.net's authenticated models endpoint and verify that the configured text model is available for Chat Completions.

## Non-Functional Requirements

- NFR-1: Every io.net request MUST time out within the configured timeout, defaulting to 30 seconds.
- NFR-2: AI completion concurrency MUST be bounded to at most two in-flight requests per bot process by default.
- NFR-3: Each guild MUST be limited to a configurable number of AI calls per minute, defaulting to 20.
- NFR-4: API credentials MUST NOT be stored in MongoDB, source files, command responses, or logs.
- NFR-5: AI functionality MUST be fail-open for moderation and fail-soft for user commands.
- NFR-6: Ticket input MUST be truncated to 24,000 characters and knowledge input to 12,000 characters.
- NFR-7: Automated tests MUST not perform live io.net requests.
- NFR-8: New guild settings MUST be additive and default to all AI features disabled.

## Acceptance Criteria

### AC-1: Missing credential (FR-1, FR-3, NFR-4)

Given no `IO_INTELLIGENCE_API_KEY` environment variable  
When an AI completion is requested  
Then the client rejects with an `AI_NOT_CONFIGURED` error  
And the error does not contain a credential value.

### AC-2: Structured completion (FR-2, FR-17)

Given a mocked successful io.net response containing fenced JSON  
When a structured completion is requested  
Then the client returns the parsed object  
And transmitted input respects configured length limits.

### AC-3: Timeout and concurrency (NFR-1, NFR-2)

Given a stalled mocked io.net request and saturated execution slots  
When additional completions are requested  
Then no more than the configured concurrency executes  
And stalled requests are aborted within the configured timeout.

### AC-4: Shadow moderation (FR-5, FR-6, FR-7, FR-9)

Given AI text moderation is enabled in `SHADOW` mode  
When the classifier returns a risk score at or above the threshold  
Then the moderator log contains the AI category and score  
And the message is not deleted  
And no strike is added.

### AC-5: Enforced moderation (FR-6, FR-8)

Given AI text moderation is enabled in `ENFORCE` mode  
When the classifier returns a risk score at or above the threshold  
Then the existing AutoMod pipeline deletes the message when deletable  
And adds exactly one strike.

### AC-6: Moderation outage (FR-9, NFR-5)

Given io.net returns an error or times out  
When a message is processed  
Then deterministic AutoMod checks still execute  
And AI adds no strike.

### AC-7: Ticket summary permissions (FR-10, FR-11)

Given an open ticket and a configured support member  
When the member runs the ticket summary action  
Then the bot returns a bounded summary  
And does not change channel state.

### AC-8: Grounded answer (FR-12, FR-13, FR-14)

Given guild knowledge is configured  
When a user asks a question  
Then the model receives the knowledge and question  
And the response is bounded for Discord  
And the prompt prohibits unsupported answers.

### AC-9: Suggestion resilience (FR-15, FR-16)

Given suggestion analysis is enabled and io.net is unavailable  
When a user submits a suggestion  
Then the suggestion is still stored and published  
And no approve or reject action is performed.

### AC-10: Disabled defaults (FR-5, NFR-8)

Given an existing guild record without AI settings  
When it is loaded  
Then semantic moderation, ticket summaries, knowledge Q&A, and suggestion analysis are disabled.

### AC-11: Image compatibility (FR-18)

Given an io.net key is configured  
When image-spam analysis runs  
Then it continues using the existing Chat Completions endpoint and configured image model.

### AC-12: Form response assistance (FR-19, FR-20, FR-21)

Given form response analysis is enabled  
When a user submits a form  
Then the stored response and staff embed are still created  
And the embed MAY contain a neutral AI summary and follow-up questions  
And it contains no acceptance, rejection, score, or ranking.

### AC-13: Model discovery (FR-22, NFR-4)

Given a valid operator credential and a mocked models response  
When the AI configuration check runs  
Then it requests `GET /api/v1/models` with bounded pagination  
And reports whether the configured model supports API Chat Completions  
And does not print the credential.

## Edge Cases and Error Scenarios

- EC-1: Empty or whitespace-only input results in a validation error without an API request.
- EC-2: io.net returns non-JSON or a response without message content; the call fails with `AI_INVALID_RESPONSE`.
- EC-3: io.net returns HTTP 429 or 5xx; the feature fails softly and includes only the HTTP status in internal errors.
- EC-4: Structured output contains Markdown fences; the JSON payload is extracted and parsed.
- EC-5: A guild exceeds its per-minute budget; the feature fails softly with `AI_RATE_LIMITED`.
- EC-6: A ticket has no user messages; the summary command reports that there is nothing to summarize.
- EC-7: Guild knowledge is empty; `ask` reports that server knowledge is not configured.
- EC-8: Suggestion analysis returns oversized strings; every field is truncated to Discord limits.
- EC-9: AI classifies a moderator message; existing AutoMod exemption rules remain effective unless AutoMod debug mode is enabled.
- EC-10: An attachment-only message has empty content; text AI moderation is skipped while image moderation remains available.
- EC-11: Form analysis fails or returns oversized output; submission remains successful and AI fields are omitted or truncated.

## API Contracts

```typescript
interface AiCompletionRequest {
  system: string;          // 1..12000 characters
  user: string;            // 1..24000 characters
  maxTokens?: number;      // 1..1200, default 400
  temperature?: number;    // 0..1, default 0
  model?: string;          // defaults to IO_INTELLIGENCE_MODEL
  guildId?: string;        // rate-limit scope
}

interface AiCompletionResult {
  content: string;
  model: string;
}

interface TextModerationResult {
  risky: boolean;
  score: number;           // 0..100
  category: "SCAM" | "HARASSMENT" | "SEXUAL" | "VIOLENCE" | "EVASION" | "OTHER" | "SAFE";
  reason: string;          // max 500 characters
}

interface TicketSummaryResult {
  summary: string;
  category: string;
  urgency: "LOW" | "MEDIUM" | "HIGH";
  nextStep: string;
}

interface KnowledgeAnswerResult {
  answered: boolean;
  answer: string;
}

interface SuggestionAnalysisResult {
  category: string;
  summary: string;
  benefits: string;
  concerns: string;
}

interface FormAnalysisResult {
  summary: string;
  followUpQuestions: string;
}
```

io.net request: `POST /api/v1/chat/completions`

```typescript
POST https://api.intelligence.io.solutions/api/v1/chat/completions
Authorization: Bearer <IO_INTELLIGENCE_API_KEY>
Content-Type: application/json

interface IoChatRequest {
  model: string;
  messages: Array<{ role: "system" | "user"; content: string }>;
  temperature: number;
  max_tokens: number;
}
```

io.net model discovery: `GET /api/v1/models?page=1&page_size=100`

## Data Models

### Guild.ai

| Field | Type | Constraints |
|---|---|---|
| enabled | Boolean | Default false |
| automod_enabled | Boolean | Default false |
| automod_mode | Enum | `SHADOW` or `ENFORCE`, default `SHADOW` |
| automod_threshold | Number | 50..100, default 85 |
| ticket_summaries | Boolean | Default false |
| knowledge_enabled | Boolean | Default false |
| knowledge | String | Default empty, max 12000 characters |
| suggestion_analysis | Boolean | Default false |
| form_analysis | Boolean | Default false |

No AI-generated content is persisted in this phase. Existing AutoMod logs MAY contain the bounded classifier reason when a result is risky.

## Out of Scope

- OS-1: Autonomous bans, kicks, timeouts, ticket closure, refunds, role grants, suggestion approval, application scoring, and application acceptance.
- OS-2: Vector databases, embeddings, semantic retrieval, and ingestion from arbitrary external URLs.
- OS-3: Automatic analysis of every historical ticket or suggestion.
- OS-4: Training or fine-tuning custom models.
- OS-5: Sending private ticket content to third-party SlayNode partner workers.
- OS-6: Voice transcription, speech generation, and image generation.
- OS-7: Production deployment or storage of an API credential in the repository.
