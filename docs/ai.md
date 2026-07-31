# SLAYBOT AI

SLAYBOT uses the io.net Chat Completions API through one bounded client. AI features are disabled for every guild by default and existing bot behavior continues when io.net is unavailable.

## Operator environment

Set secrets only in the runtime environment or the server's secret manager:

```bash
IO_INTELLIGENCE_API_KEY=<new io.net token>
IO_INTELLIGENCE_MODEL=meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8
```

Optional limits:

```bash
IO_INTELLIGENCE_TIMEOUT_MS=30000
IO_INTELLIGENCE_CONCURRENCY=2
IO_INTELLIGENCE_CALLS_PER_MINUTE=20
```

Validate the credential and configured model without starting Discord:

```bash
npm run ai:check
```

`IO_INTELLIGENCE_API_KEY` is also used by the existing remote image-spam classifier. Image analysis can keep a separate model override through `IMAGE_SPAM_REMOTE_MODEL`.

Never place API credentials in `config.js`, MongoDB, command arguments, commits, screenshots, or logs. Revoke any token that has been pasted into chat or another shared location before production use.

## Guild configuration

Only members with `Manage Server` can change AI settings.

```text
/ai status
/ai enable status:ON
/ai automod status:ON mode:SHADOW threshold:85
/ai tickets status:ON
/ai suggestions status:ON
/ai forms status:ON
/ai knowledge-set content:<server rules and FAQ>
```

Recommended rollout:

1. Configure a fresh io.net key and restart the bot.
2. Run `/ai status` and confirm the provider is configured.
3. Enable the master switch.
4. Enable text AutoMod in `SHADOW` mode.
5. Review moderator logs and false positives before selecting `ENFORCE`.
6. Enable ticket, suggestion, form, and knowledge features independently.

## Features

### Semantic text AutoMod

The classifier looks for scams, phishing, targeted harassment, sexual solicitation, threats, and deliberate filter evasion.

- `SHADOW`: sends a moderator log and writes an AutoMod audit entry with zero strikes.
- `ENFORCE`: uses the existing message deletion and strike pipeline.
- Provider errors, timeouts, and rate limits fail open.
- Existing moderator exemptions and AutoMod debug behavior remain unchanged.

### Ticket summaries

Configured ticket staff can run `/ticket summary` inside an open ticket. The model receives at most the latest 24,000 transcript characters and returns a category, urgency, factual summary, and suggested next step. It cannot close the ticket or change permissions.

### Server knowledge

`/ask` answers from the text configured with `/ai knowledge-set`. The model is instructed to say when an answer is absent instead of relying on general knowledge.

### Suggestions

When enabled, new suggestions receive a neutral category, summary, possible benefits, and concerns. AI cannot approve, reject, or delete a suggestion. Submission continues normally if analysis fails.

### Forms

When enabled, staff receive a neutral response summary and possible follow-up questions. AI does not score, rank, accept, or reject applicants. The original form response is stored before AI analysis begins.

## Safety and privacy

- Prompts treat Discord content as untrusted data to reduce prompt-injection risk.
- Credentials are never included in public errors.
- Inputs and Discord outputs are truncated to bounded sizes.
- Ticket content is sent directly from the main bot to io.net and is never dispatched to partner SlayNode workers.
- AI output is advisory except for explicitly enabled `ENFORCE` text moderation.
- Calls are constrained by timeout, concurrency, and per-guild minute budgets.
