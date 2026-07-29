# SlayNode Partner

SlayNode is an untrusted compute worker, not a Discord bot replica. Only the central SlayBot owns the Discord gateway, bot token, MongoDB connection and moderation decision. Workers receive a versioned allowlisted job envelope and never receive a Discord `Message`, IDs beyond the explicitly consented guild affinity, or central credentials.

## Data flow and trust

The control plane uses MongoDB as the durable queue. A worker enrolls once, receives a unique credential, then sends HMAC-authenticated outbound HTTPS requests with timestamp and nonce replay protection. TLS is mandatory at the reverse proxy in production; it protects transport, not data from the worker owner. `PUBLIC` and `ANONYMIZED` are safe defaults. `GUILD_PRIVATE` image bytes are dispatched only when the guild has opted in and only to a node bound to that guild. `CENTRAL_ONLY` is rejected by protocol validation.

Jobs transition through `QUEUED → LEASED → SUCCEEDED`, or retry with exponential backoff and jitter before `DEAD`. Lease IDs make ack/nack idempotent. A unique job ID, optional idempotency key, result digest and unique ledger `jobId` prevent duplicate rewards. Payloads are removed after their short retention window; audit events record category and byte count, never raw content. Credits use integer micro-credit units and the immutable ledger is authoritative; the account balance is a transactional cache.

The image-spam adapter keeps its public API. For opted-in guilds it tries `image.spam.v1`, then falls back centrally after a deadline. Three consecutive distributed timeouts open a one-minute circuit breaker. Moderation itself remains fail-open.

Lavalink remains an independently monitored partner capability; its protocol is intentionally not placed in the compute queue.

## Operation

Set `SLAYNODE.enabled` in `config.js`, set a random `SLAYNODE_MASTER_KEY` of at least 32 characters, and expose the control port through an HTTPS reverse proxy. The service provides `/health`, `/ready`, and Prometheus text at `/metrics`.

The supported worker installation path is `scripts/install-slaynode.sh`. It requires Docker Engine and Compose v2, downloads or copies the worker build context, builds the image, performs one-time enrollment inside a container, writes the node-specific credentials to a mode-`0600` `.env`, starts Compose and waits for the worker to report a recent successful control-plane heartbeat. An existing `.env` is reused during updates.

Worker containers are non-root, read-only, capability-free, PID/CPU/RAM limited, log-rotated, and each executor runs in a child process with a memory ceiling and timeout. The OCR/vision model cache uses a named volume so restarts do not repeatedly download model weights. Configure host-level GPU exposure separately; no shell command is accepted from a job.

The Docker healthcheck reads worker-owned state from the container tmpfs. It is healthy only when the last authenticated heartbeat succeeded within the configured maximum age. A live process with invalid credentials or an unreachable control plane is therefore reported as unhealthy.

Relevant environment variables:

- Control: `SLAYNODE_MASTER_KEY` (required when enabled).
- Worker identity: `SLAYNODE_CONTROL_URL`, `SLAYNODE_ID`, `SLAYNODE_SECRET`.
- Limits: `SLAYNODE_PARALLELISM`, `SLAYNODE_RAM_MB`, `SLAYNODE_JOB_TIMEOUT_MS`, `SLAYNODE_CPU_LIMIT`, `SLAYNODE_MEMORY_LIMIT`, `SLAYNODE_HEALTH_MAX_AGE_MS`.
- Models: `IMAGE_SPAM_MODEL_CACHE`, `IMAGE_SPAM_VISION_MODEL`.

The current repository has no dashboard implementation. Management is therefore provided through the real control API and `/slaynode` Discord command rather than a placeholder UI.
