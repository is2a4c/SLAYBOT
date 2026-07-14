const { createControlPlane } = require("./server");
const models = require("../../database/schemas/slaynode");
const { PRIVACY, JOB_TYPES } = require("../protocol");
const { enqueueCanaries, recalculateAllTiers } = require("./partner");

let runtime;
let breakerFailures = 0;
let breakerUntil = 0;

async function start(client) {
  if (!client.config.SLAYNODE?.enabled || runtime) return runtime;
  runtime = createControlPlane({
    leaseMs: client.config.SLAYNODE.leaseMs,
    maxPayloadBytes: client.config.SLAYNODE.maxPayloadBytes,
    verificationRate: client.config.SLAYNODE.verificationRate,
    allowedWorkerDigests: client.config.SLAYNODE.allowedWorkerDigests,
  });
  runtime.server = runtime.app.listen(client.config.SLAYNODE.port, client.config.SLAYNODE.host, () =>
    client.logger.success(
      `SlayNode Control Plane listening on ${client.config.SLAYNODE.host}:${client.config.SLAYNODE.port}`
    )
  );
  runtime.reaper = setInterval(
    () => runtime.queue.reap().catch((error) => client.logger.error("SlayNode lease reaper failed", error)),
    10_000
  );
  runtime.reaper.unref();
  runtime.canaries = setInterval(
    () => enqueueCanaries(runtime.queue).catch((error) => client.logger.error("SlayNode canary failed", error)),
    client.config.SLAYNODE.canaryIntervalMs
  );
  runtime.tiers = setInterval(
    () =>
      recalculateAllTiers(client.config.SLAYNODE.tiers).catch((error) =>
        client.logger.error("Partner tier update failed", error)
      ),
    60 * 60_000
  );
  runtime.canaries.unref();
  runtime.tiers.unref();
  runtime.health = setInterval(
    () =>
      models.Node.updateMany(
        { status: { $in: ["ONLINE", "DEGRADED"] }, lastHeartbeatAt: { $lt: new Date(Date.now() - 45_000) } },
        { $set: { status: "OFFLINE" } }
      ).catch((error) => client.logger.error("SlayNode health update failed", error)),
    15_000
  );
  runtime.health.unref();
  return runtime;
}

async function stop() {
  if (!runtime) return;
  clearInterval(runtime.reaper);
  clearInterval(runtime.canaries);
  clearInterval(runtime.tiers);
  clearInterval(runtime.health);
  await new Promise((resolve) => runtime.server.close(resolve));
  runtime = undefined;
}

async function dispatchImageSpam({ buffer, caption, threshold, guildId, timeoutMs = 20_000 }) {
  if (!runtime || Date.now() < breakerUntil || !guildId) return null;
  const policy = await models.PrivacyPolicy.findOne({
    guildId,
    allowGuildPrivate: true,
    allowedJobTypes: JOB_TYPES.IMAGE_SPAM,
  });
  if (!policy) return null;
  const job = await runtime.queue.enqueue({
    type: JOB_TYPES.IMAGE_SPAM,
    privacyClass: PRIVACY.GUILD_PRIVATE,
    guildId,
    payload: { imageBase64: buffer.toString("base64"), caption, threshold },
    idempotencyKey: `image-spam:${guildId}:${require("../protocol").digest(buffer)}:${threshold}`,
    deadlineAt: new Date(Date.now() + timeoutMs),
    priority: 100,
  });
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const current = await models.ComputeJob.findOne({ jobId: job.jobId });
    if (current?.status === "SUCCEEDED") {
      breakerFailures = 0;
      return current.result;
    }
    if (["FAILED", "DEAD", "CANCELLED"].includes(current?.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  breakerFailures += 1;
  if (breakerFailures >= 3) {
    breakerUntil = Date.now() + 60_000;
    breakerFailures = 0;
  }
  return null;
}

module.exports = { start, stop, dispatchImageSpam };
