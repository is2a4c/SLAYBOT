const crypto = require("crypto");

const DEFAULT_RETENTION_DAYS = 400;
const DEFAULT_FLUSH_INTERVAL_MS = 15000;
const DEFAULT_MAX_BUFFERED_EVENTS = 5000;
const VALID_COUNTERS = new Set([
  "messages",
  "interactions",
  "commands",
  "command_successes",
  "command_failures",
  "slash_commands",
  "prefix_commands",
  "context_commands",
  "button_interactions",
  "modal_interactions",
  "automod_actions",
  "automod_deletions",
  "automod_strikes",
  "member_joins",
  "member_leaves",
  "guild_joins",
  "guild_leaves",
  "voice_joins",
  "voice_leaves",
  "voice_seconds",
  "client_errors",
  "client_warnings",
]);

function utcDay(value = new Date()) {
  const date = new Date(value);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addDays(value, days) {
  const date = new Date(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

function bucketId(bucketStart, scope, guildId) {
  return `${bucketStart.toISOString().slice(0, 10)}:${scope}:${guildId || "all"}`;
}

function normalizeCommandName(commandName) {
  return String(commandName || "unknown")
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "_")
    .slice(0, 48);
}

function emptySummary(periodDays, scope, guildId) {
  return {
    periodDays,
    scope,
    guildId: guildId || null,
    counters: Object.fromEntries([...VALID_COUNTERS].map((name) => [name, 0])),
    commandUsage: {},
    commandLatency: {
      totalMs: 0,
      samples: 0,
      maxMs: 0,
      averageMs: 0,
    },
    activeUsers: null,
  };
}

class TelemetryService {
  constructor({
    config = {},
    bucketModel = require("@schemas/TelemetryBucket"),
    actorModel = require("@schemas/TelemetryActor"),
    logger = console,
    hashSecret = process.env.TELEMETRY_HASH_SALT || process.env.BOT_TOKEN,
    now = () => new Date(),
  } = {}) {
    this.config = {
      enabled: config.enabled !== false,
      retentionDays: Number(config.retentionDays) || DEFAULT_RETENTION_DAYS,
      flushIntervalMs: Number(config.flushIntervalMs) || DEFAULT_FLUSH_INTERVAL_MS,
      maxBufferedEvents: Number(config.maxBufferedEvents) || DEFAULT_MAX_BUFFERED_EVENTS,
    };
    this.bucketModel = bucketModel;
    this.actorModel = actorModel;
    this.logger = logger;
    this.hashSecret = hashSecret || null;
    this.now = now;
    this.bucketBuffer = new Map();
    this.actorBuffer = new Map();
    this.voiceSessions = new Map();
    this.bufferedEvents = 0;
    this.flushPromise = null;
    this.timer = null;
  }

  start() {
    if (!this.config.enabled || this.timer) return;
    this.timer = setInterval(() => {
      this.flush().catch((error) => this.logger.warn(`Telemetry flush failed: ${error.message}`));
    }, this.config.flushIntervalMs);
    this.timer.unref?.();
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.flush();
  }

  record(counter, { guildId = null, userId = null, value = 1, at = this.now() } = {}) {
    if (!this.config.enabled || !VALID_COUNTERS.has(counter)) return;
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount === 0) return;

    this.addCounter("global", null, counter, amount, at);
    if (guildId) this.addCounter("guild", String(guildId), counter, amount, at);
    if (userId) this.addActor(userId, guildId, at);

    this.bufferedEvents += 1;
    if (this.bufferedEvents >= this.config.maxBufferedEvents) {
      this.flush().catch((error) => this.logger.warn(`Telemetry flush failed: ${error.message}`));
    }
  }

  recordInteraction(interaction) {
    const data = {
      guildId: interaction.guildId,
      userId: interaction.user?.id || interaction.member?.id,
    };
    this.record("interactions", data);
    if (interaction.isContextMenuCommand?.()) this.record("context_commands", data);
    if (interaction.isButton?.()) this.record("button_interactions", data);
    if (interaction.isModalSubmit?.()) this.record("modal_interactions", data);
  }

  recordCommand({ guildId, userId, commandName, source, success, durationMs, at = this.now() }) {
    if (!this.config.enabled) return;
    const data = { guildId, userId, at };
    this.record("commands", data);
    this.record(source === "slash" ? "slash_commands" : "prefix_commands", data);
    this.record(success ? "command_successes" : "command_failures", data);

    for (const [scope, scopedGuildId] of this.scopes(guildId)) {
      const entry = this.getBucket(scope, scopedGuildId, at);
      const name = normalizeCommandName(commandName);
      entry.increments[`command_usage.${name}`] = (entry.increments[`command_usage.${name}`] || 0) + 1;
      const duration = Math.max(0, Number(durationMs) || 0);
      entry.increments["command_latency.total_ms"] = (entry.increments["command_latency.total_ms"] || 0) + duration;
      entry.increments["command_latency.samples"] = (entry.increments["command_latency.samples"] || 0) + 1;
      entry.max["command_latency.max_ms"] = Math.max(entry.max["command_latency.max_ms"] || 0, duration);
    }
  }

  recordAutomod({ guildId, userId, deleted = false, strikes = 0 }) {
    this.record("automod_actions", { guildId, userId });
    if (deleted) this.record("automod_deletions", { guildId, userId });
    if (strikes > 0) this.record("automod_strikes", { guildId, userId, value: strikes });
  }

  recordVoiceState(oldState, newState, at = this.now()) {
    const member = newState.member || oldState.member;
    if (!member || member.user?.bot) return;
    const guildId = newState.guild?.id || oldState.guild?.id;
    const userId = member.id;
    const key = `${guildId}:${userId}`;

    if (!oldState.channelId && newState.channelId) {
      this.voiceSessions.set(key, new Date(at).getTime());
      this.record("voice_joins", { guildId, userId, at });
    } else if (oldState.channelId && !newState.channelId) {
      this.record("voice_leaves", { guildId, userId, at });
      const startedAt = this.voiceSessions.get(key);
      if (startedAt) {
        const seconds = Math.max(0, Math.round((new Date(at).getTime() - startedAt) / 1000));
        if (seconds) this.record("voice_seconds", { guildId, userId, value: seconds, at });
        this.voiceSessions.delete(key);
      }
    }
  }

  async getSummary({ scope, guildId = null, periodDays = 7, now = this.now() }) {
    const days = Math.min(30, Math.max(1, Number(periodDays) || 7));
    if (scope !== "global" && scope !== "guild") throw new Error("Unsupported telemetry scope");
    if (scope === "guild" && !guildId) throw new Error("guildId is required for guild telemetry");

    await this.flush();
    const start = utcDay(addDays(now, -(days - 1)));
    const filter = {
      scope,
      guild_id: scope === "guild" ? String(guildId) : null,
      bucket_start: { $gte: start, $lte: new Date(now) },
    };
    const docs = await this.bucketModel.find(filter).lean();
    const summary = emptySummary(days, scope, guildId);

    for (const doc of docs) {
      for (const counter of VALID_COUNTERS) {
        summary.counters[counter] += Number(doc.counters?.[counter] || 0);
      }
      const usage = doc.command_usage instanceof Map ? Object.fromEntries(doc.command_usage) : doc.command_usage || {};
      for (const [name, count] of Object.entries(usage)) {
        summary.commandUsage[name] = (summary.commandUsage[name] || 0) + Number(count || 0);
      }
      summary.commandLatency.totalMs += Number(doc.command_latency?.total_ms || 0);
      summary.commandLatency.samples += Number(doc.command_latency?.samples || 0);
      summary.commandLatency.maxMs = Math.max(summary.commandLatency.maxMs, Number(doc.command_latency?.max_ms || 0));
    }

    if (summary.commandLatency.samples > 0) {
      summary.commandLatency.averageMs = Math.round(summary.commandLatency.totalMs / summary.commandLatency.samples);
    }

    if (this.hashSecret) {
      const actors = await this.actorModel.aggregate([
        { $match: filter },
        { $group: { _id: "$actor_hash" } },
        { $count: "count" },
      ]);
      summary.activeUsers = actors[0]?.count || 0;
    }

    return summary;
  }

  scopes(guildId) {
    return guildId
      ? [
          ["global", null],
          ["guild", String(guildId)],
        ]
      : [["global", null]];
  }

  addCounter(scope, guildId, counter, amount, at) {
    const entry = this.getBucket(scope, guildId, at);
    const path = `counters.${counter}`;
    entry.increments[path] = (entry.increments[path] || 0) + amount;
  }

  getBucket(scope, guildId, at) {
    const bucketStart = utcDay(at);
    const id = bucketId(bucketStart, scope, guildId);
    if (!this.bucketBuffer.has(id)) {
      this.bucketBuffer.set(id, {
        id,
        bucketStart,
        scope,
        guildId,
        expiresAt: addDays(bucketStart, this.config.retentionDays),
        increments: {},
        max: {},
      });
    }
    return this.bucketBuffer.get(id);
  }

  addActor(userId, guildId, at) {
    if (!this.hashSecret) return;
    const actorHash = crypto.createHmac("sha256", this.hashSecret).update(String(userId)).digest("hex");
    const bucketStart = utcDay(at);
    for (const [scope, scopedGuildId] of this.scopes(guildId)) {
      const id = `${bucketId(bucketStart, scope, scopedGuildId)}:${actorHash}`;
      this.actorBuffer.set(id, {
        id,
        bucketStart,
        scope,
        guildId: scopedGuildId,
        actorHash,
        expiresAt: addDays(bucketStart, this.config.retentionDays),
      });
    }
  }

  async flush() {
    if (!this.config.enabled) return;
    if (this.flushPromise) return this.flushPromise;
    if (this.bucketBuffer.size === 0 && this.actorBuffer.size === 0) return;

    const buckets = this.bucketBuffer;
    const actors = this.actorBuffer;
    this.bucketBuffer = new Map();
    this.actorBuffer = new Map();
    this.bufferedEvents = 0;

    this.flushPromise = this.persist(buckets, actors)
      .catch((error) => {
        this.restoreBuffers(buckets, actors);
        throw error;
      })
      .finally(() => {
        this.flushPromise = null;
      });
    return this.flushPromise;
  }

  async persist(buckets, actors) {
    const bucketOperations = [...buckets.values()].map((entry) => {
      const update = {
        $setOnInsert: {
          _id: entry.id,
          bucket_start: entry.bucketStart,
          scope: entry.scope,
          guild_id: entry.guildId,
          expires_at: entry.expiresAt,
        },
        $inc: entry.increments,
      };
      if (Object.keys(entry.max).length > 0) update.$max = entry.max;
      return {
        updateOne: {
          filter: { _id: entry.id },
          update,
          upsert: true,
        },
      };
    });
    const actorOperations = [...actors.values()].map((entry) => ({
      updateOne: {
        filter: { _id: entry.id },
        update: {
          $setOnInsert: {
            _id: entry.id,
            bucket_start: entry.bucketStart,
            scope: entry.scope,
            guild_id: entry.guildId,
            actor_hash: entry.actorHash,
            expires_at: entry.expiresAt,
          },
        },
        upsert: true,
      },
    }));

    if (bucketOperations.length > 0) await this.bucketModel.bulkWrite(bucketOperations, { ordered: false });
    if (actorOperations.length > 0) await this.actorModel.bulkWrite(actorOperations, { ordered: false });
  }

  restoreBuffers(buckets, actors) {
    for (const entry of buckets.values()) {
      const current = this.bucketBuffer.get(entry.id);
      if (!current) {
        this.bucketBuffer.set(entry.id, entry);
        continue;
      }
      for (const [path, value] of Object.entries(entry.increments)) {
        current.increments[path] = (current.increments[path] || 0) + value;
      }
      for (const [path, value] of Object.entries(entry.max)) {
        current.max[path] = Math.max(current.max[path] || 0, value);
      }
    }
    for (const [id, entry] of actors) this.actorBuffer.set(id, entry);
  }
}

module.exports = {
  TelemetryService,
  VALID_COUNTERS,
  emptySummary,
  normalizeCommandName,
  utcDay,
};
