# SLAYBOT telemetry

SLAYBOT aggregates operational telemetry into UTC day buckets. It is separate
from member XP/stat tracking and continues to measure bot health when a guild
has disabled XP.

## Access

- Bot owners configured in `OWNER_IDS` can view the global scope and the
  current server scope.
- Members with `Manage Server` can view only the server in which they run the
  command.
- Slash replies are ephemeral. Prefix replies are subject to normal Discord
  channel visibility, so slash commands are recommended for private reports.

Use `/telemetry` or:

```text
!telemetry server 7d
!telemetry global 30d
```

Reports support today, 7 days, and 30 days.

## Collected data

The daily aggregates cover:

- messages and active users;
- slash, prefix, context, button, and modal interactions;
- command success/failure, average/max execution time, and command popularity;
- AutoMod actions, deletions, and strikes;
- member, guild, and voice joins/leaves plus observed voice duration;
- Discord client errors and warnings.

No message content, usernames, raw error messages, stack traces, channel names,
or command arguments are stored. Active users are deduplicated with an HMAC
hash. Set a stable `TELEMETRY_HASH_SALT`; when it is absent, the running bot
token is used only as an in-memory HMAC key and is never written to telemetry.

## Storage and failure behavior

Events are buffered in memory and written to MongoDB in unordered batches every
15 seconds (or after 5,000 buffered events). Both global and guild-level daily
buckets are updated atomically. Failed batches are returned to the buffer;
telemetry failure never blocks a Discord command or message flow.

Daily buckets and pseudonymous actor records expire after 400 days by default.
Configure these values through `TELEMETRY`:

```js
TELEMETRY: {
  enabled: true,
  retentionDays: 400,
  flushIntervalMs: 15000,
  maxBufferedEvents: 5000,
}
```

## Capacity and service targets

The initial profile assumes a shared multi-tenant bot, write-heavy event
collection below 10 events/second per instance, and infrequent report reads.
Telemetry adds no network wait to event handling. Targets are:

- event-path overhead p99 below 5 ms;
- report latency p95 below 1 second and p99 below 2 seconds;
- telemetry availability 99.5%;
- RPO up to 30 seconds and RTO up to 15 minutes.

At sustained rates above 100 events/second per instance, validate MongoDB write
capacity and consider increasing the batch size before extending dimensions.
