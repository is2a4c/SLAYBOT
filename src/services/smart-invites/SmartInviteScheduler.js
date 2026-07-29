class SmartInviteScheduler {
  constructor(service, options = {}) {
    this.service = service;
    this.config = options.config || service.config;
    this.random = options.random || Math.random;
    this.timer = null;
    this.running = false;
    this.stopping = false;
    this.inFlight = new Set();
  }

  start() {
    if (this.timer || !this.config.backgroundChecks) return;
    this.stopping = false;
    const jitter = Math.floor(this.random() * Math.min(this.config.healthCheckIntervalMs, 60000));
    this.timer = setTimeout(() => this.tick(), jitter);
    this.timer.unref?.();
  }

  scheduleNext() {
    if (this.stopping) return;
    const interval = this.config.healthCheckIntervalMs;
    const jitter = Math.floor((this.random() - 0.5) * Math.min(interval * 0.2, 60000));
    this.timer = setTimeout(() => this.tick(), Math.max(1000, interval + jitter));
    this.timer.unref?.();
  }

  async tick() {
    if (this.running || this.stopping) return this.scheduleNext();
    this.running = true;
    this.timer = null;
    try {
      await this.service.pruneExpiredAliases();
      const dueBefore = new Date(Date.now() - this.config.validationTtlMs);
      const records = await this.service.model
        .find({
          status: { $in: ["active", "degraded"] },
          $and: [
            {
              $or: [{ lastValidatedAt: null }, { lastValidatedAt: { $lte: dueBefore } }],
            },
            {
              $or: [{ nextValidationAt: null }, { nextValidationAt: { $lte: new Date() } }],
            },
          ],
        })
        .sort({ lastValidatedAt: 1 })
        .limit(this.config.backgroundConcurrency * 4);

      const queue = records.slice();
      const workers = Array.from({ length: Math.min(this.config.backgroundConcurrency, queue.length) }, () =>
        this.runWorker(queue)
      );
      await Promise.all(workers);
    } finally {
      this.running = false;
      this.scheduleNext();
    }
  }

  async runWorker(queue) {
    while (queue.length && !this.stopping) {
      const record = queue.shift();
      const task = this.service.ensureUsable(record, { force: true }).catch(() => {});
      this.inFlight.add(task);
      await task;
      this.inFlight.delete(task);
    }
  }

  async stop(timeoutMs = 5000) {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const work = Promise.allSettled([...this.inFlight]);
    await Promise.race([
      work,
      new Promise((resolve) => {
        const timer = setTimeout(resolve, timeoutMs);
        timer.unref?.();
      }),
    ]);
  }
}

module.exports = SmartInviteScheduler;
