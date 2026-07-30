const {
  scheduleTask,
  claimDueTasks,
  completeTask,
  failTask,
  cancelTasks,
  listTasks,
} = require("@schemas/ScheduledTask");

const DEFAULT_POLL_INTERVAL_MS = 15_000;
const DEFAULT_BATCH_SIZE = 25;
const DEFAULT_LEASE_MS = 60_000;

/**
 * Durable timer for everything the bot has to do later: temporary roles,
 * reminders, scheduled events, giveaway-style deadlines.
 *
 * Timers live in MongoDB rather than in `setTimeout`, so a restart never loses
 * a pending action and a task that fires while the bot was offline runs on the
 * next poll instead of silently disappearing.
 */
class Scheduler {
  /**
   * @param {{client: import('@src/structures').BotClient, pollIntervalMs?: number, batchSize?: number, leaseMs?: number}} options
   */
  constructor({
    client,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    batchSize = DEFAULT_BATCH_SIZE,
    leaseMs = DEFAULT_LEASE_MS,
  } = {}) {
    this.client = client;
    this.pollIntervalMs = pollIntervalMs;
    this.batchSize = batchSize;
    this.leaseMs = leaseMs;
    this.handlers = new Map();
    this.timer = null;
    this.running = false;
  }

  /**
   * @param {string} type
   * @param {(payload: object, context: {client: object, task: object}) => Promise<void>} handler
   */
  register(type, handler) {
    if (typeof handler !== "function") throw new TypeError(`Handler for ${type} must be a function`);
    this.handlers.set(type, handler);
    return this;
  }

  /**
   * @param {{type: string, guildId: string, runAt: Date|number, payload?: object, dedupeKey?: string}} task
   */
  schedule(task) {
    return scheduleTask(task);
  }

  /**
   * @param {{type?: string, guildId?: string, dedupeKey?: string, payloadMatch?: object}} filter
   */
  cancel(filter) {
    return cancelTasks(filter);
  }

  /**
   * @param {{type: string, guildId: string, payloadMatch?: object, limit?: number}} filter
   */
  list(filter) {
    return listTasks(filter);
  }

  /**
   * Run one polling pass. Exposed separately so tests can drive the loop
   * deterministically instead of waiting on the interval.
   * @param {Date} [now]
   */
  async tick(now = new Date()) {
    const types = [...this.handlers.keys()];
    if (types.length === 0) return { processed: 0, failed: 0 };

    const tasks = await claimDueTasks({ limit: this.batchSize, leaseMs: this.leaseMs, now, types });

    let processed = 0;
    let failed = 0;

    for (const task of tasks) {
      const handler = this.handlers.get(task.type);
      if (!handler) continue;

      try {
        await handler(task.payload || {}, { client: this.client, task });
        await completeTask(task._id);
        processed += 1;
      } catch (error) {
        failed += 1;
        const { dropped, message } = await failTask(task, error);
        this.client?.logger?.error(
          `Scheduler: ${task.type} failed${dropped ? " (dropped after max attempts)" : ", will retry"}: ${message}`,
          error
        );
      }
    }

    return { processed, failed };
  }

  start() {
    if (this.timer) return this;

    const run = async () => {
      if (this.running) return;
      this.running = true;
      try {
        await this.tick();
      } catch (error) {
        this.client?.logger?.error("Scheduler tick failed", error);
      } finally {
        this.running = false;
      }
    };

    this.timer = setInterval(run, this.pollIntervalMs);
    if (typeof this.timer.unref === "function") this.timer.unref();
    run();

    this.client?.logger?.success(`Scheduler started (${this.handlers.size} task types)`);
    return this;
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

module.exports = { Scheduler, DEFAULT_POLL_INTERVAL_MS };
