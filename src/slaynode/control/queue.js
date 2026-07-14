const crypto = require("crypto");
const mongoose = require("mongoose");
const models = require("../../database/schemas/slaynode");
const { PROTOCOL_VERSION, validateJob, digest, stableJson } = require("../protocol");
const { execute } = require("../executors");

const id = () => crypto.randomUUID();
const nowPlus = (ms) => new Date(Date.now() + ms);

class DurableQueue {
  constructor(options = {}) {
    this.leaseMs = options.leaseMs || 60_000;
    this.payloadRetentionMs = options.payloadRetentionMs || 60 * 60_000;
    this.jobRetentionMs = options.jobRetentionMs || 7 * 86400_000;
    this.maxPayloadBytes = options.maxPayloadBytes || 8 * 1024 * 1024;
    this.verificationRate = options.verificationRate ?? 0.05;
    this.generalPoolDelayMs = options.generalPoolDelayMs || 2_000;
  }

  async enqueue(input) {
    const job = validateJob(
      { ...input, protocolVersion: input.protocolVersion || PROTOCOL_VERSION },
      this.maxPayloadBytes
    );
    const payloadBytes = Buffer.byteLength(JSON.stringify(job.payload || {}));
    const document = {
      ...job,
      jobId: job.jobId || id(),
      payloadBytes,
      payloadDigest: digest(job.payload || {}),
      deadlineAt: job.deadlineAt || nowPlus(120_000),
      deletePayloadAt: nowPlus(this.payloadRetentionMs),
      expiresAt: nowPlus(this.jobRetentionMs),
    };
    try {
      return await models.ComputeJob.create(document);
    } catch (error) {
      if (error.code === 11000 && job.idempotencyKey)
        return models.ComputeJob.findOne({ idempotencyKey: job.idempotencyKey });
      throw error;
    }
  }

  async lease(node) {
    const now = new Date();
    if ((node.load?.running || 0) >= (node.limits?.parallelism || node.resources?.parallelism || 1)) return null;
    if (node.cooldownUntil && node.cooldownUntil > now) return null;
    if (node.schedule?.enabled) {
      const hour = now.getUTCHours();
      const start = node.schedule.startHourUtc;
      const end = node.schedule.endHourUtc;
      const active = start <= end ? hour >= start && hour < end : hour >= start || hour < end;
      if (!active) return null;
    }
    const allowedPrivacy = node.privacyClasses || [];
    const base = {
      status: "QUEUED",
      nextAttemptAt: { $lte: now },
      deadlineAt: { $gt: now },
      type: { $in: node.capabilities },
      privacyClass: { $in: allowedPrivacy },
      targetNodeId: { $in: [null, node.nodeId] },
    };
    const leaseId = id();
    const claim = (extra) =>
      models.ComputeJob.findOneAndUpdate(
        { ...base, ...extra },
        {
          $set: { status: "LEASED", leasedTo: node.nodeId, leaseId, leaseExpiresAt: nowPlus(this.leaseMs) },
          $inc: { attempts: 1 },
        },
        { sort: { priority: -1, createdAt: 1 }, new: true }
      ).select("+payload");

    let job = node.guildIds?.length ? await claim({ guildId: { $in: node.guildIds } }) : null;
    if (!job && node.trustedCentral) job = await claim({});
    if (!job && !node.trustedCentral) {
      const policies = await models.PrivacyPolicy.find({ allowGeneralPool: true }).select("guildId").lean();
      job = await claim({
        createdAt: { $lte: new Date(Date.now() - this.generalPoolDelayMs) },
        $or: [
          { privacyClass: "PUBLIC", guildId: { $exists: false } },
          { privacyClass: "ANONYMIZED", guildId: { $in: policies.map((policy) => policy.guildId) } },
        ],
      });
    }
    if (!job) return null;
    await models.ComputeJobAttempt.create({
      jobId: job.jobId,
      leaseId,
      nodeId: node.nodeId,
      status: "LEASED",
      startedAt: now,
    });
    return job;
  }

  async complete(node, leaseId, result) {
    if (Buffer.byteLength(stableJson(result)) > this.maxPayloadBytes) {
      throw Object.assign(new Error("result too large"), { statusCode: 413 });
    }
    const job = await models.ComputeJob.findOne({
      leaseId,
      leasedTo: node.nodeId,
      status: "LEASED",
      leaseExpiresAt: { $gt: new Date() },
    }).select("+payload");
    if (!job) throw Object.assign(new Error("invalid or expired lease"), { statusCode: 409 });
    const attempt = await models.ComputeJobAttempt.findOne({ leaseId, status: "LEASED" });
    const serverExecutionMs = Math.max(0, Date.now() - (attempt?.startedAt?.getTime() || Date.now()));
    const resultDigest = digest(result);
    if (job.canary && resultDigest !== job.expectedDigest) return this.reject(job, node, leaseId, "CANARY_MISMATCH");
    if (!job.canary && Math.random() < this.verificationRate) {
      const verified = await execute(job.type, job.payload);
      if (digest(verified) !== resultDigest) return this.reject(job, node, leaseId, "VERIFICATION_MISMATCH");
    }
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const updated = await models.ComputeJob.updateOne(
          { _id: job._id, status: "LEASED", leaseId },
          {
            $set: {
              status: "SUCCEEDED",
              result,
              resultDigest,
              acceptedAt: new Date(),
              payload: null,
              deletePayloadAt: new Date(),
            },
            $unset: { leaseId: 1, leaseExpiresAt: 1 },
          },
          { session }
        );
        if (!updated.modifiedCount) throw new Error("lease was already completed");
        await models.ComputeJobAttempt.updateOne(
          { leaseId },
          { $set: { status: "ACKED", finishedAt: new Date(), latencyMs: serverExecutionMs } },
          { session }
        );
        const day = new Date();
        day.setUTCHours(0, 0, 0, 0);
        await models.NodeDailyMetrics.updateOne(
          { nodeId: node.nodeId, day },
          {
            $inc: {
              accepted: 1,
              canaryPassed: job.canary ? 1 : 0,
              latencyTotalMs: serverExecutionMs,
              computeMs: serverExecutionMs,
            },
            $setOnInsert: { guildId: job.guildId },
          },
          { upsert: true, session }
        );
        if (job.guildId) {
          const weights = {
            "image.prepare.v1": 100,
            "image.ocr.v1": 500,
            "image.vision.v1": 1000,
            "image.spam.v1": 1500,
            "canary.sha256.v1": 0,
          };
          const amountMicros = Math.max(
            1,
            Math.min(1_000_000, (weights[job.type] || 10) + Math.ceil(job.payloadBytes / 1024))
          );
          await models.CreditLedgerEntry.create(
            [
              {
                entryId: id(),
                guildId: job.guildId,
                nodeId: node.nodeId,
                jobId: job.jobId,
                amountMicros,
                reason: "ACCEPTED_JOB",
              },
            ],
            { session }
          );
          await models.GuildPartnerAccount.updateOne(
            { guildId: job.guildId },
            { $inc: { cachedBalanceMicros: amountMicros }, $setOnInsert: { tier: "Bronze" } },
            { upsert: true, session }
          );
        }
      });
      await models.Node.updateOne({ nodeId: node.nodeId }, [
        { $set: { reliability: { $min: [1, { $add: ["$reliability", job.canary ? 0.005 : 0.001] }] } } },
      ]);
      return { accepted: true, jobId: job.jobId };
    } finally {
      await session.endSession();
    }
  }

  async reject(job, node, leaseId, errorCode) {
    const dead = job.attempts >= job.maxAttempts;
    const backoff = Math.min(300_000, 1000 * 2 ** Math.max(0, job.attempts - 1)) + Math.floor(Math.random() * 1000);
    await models.ComputeJob.updateOne(
      { _id: job._id, leaseId },
      {
        $set: { status: dead ? "DEAD" : "QUEUED", nextAttemptAt: nowPlus(backoff), errorCode },
        $unset: { leaseId: 1, leaseExpiresAt: 1, leasedTo: 1 },
      }
    );
    await models.ComputeJobAttempt.updateOne(
      { leaseId },
      { $set: { status: "REJECTED", finishedAt: new Date(), errorCode } }
    );
    const day = new Date();
    day.setUTCHours(0, 0, 0, 0);
    await Promise.all([
      models.Node.updateOne({ nodeId: node.nodeId }, [
        {
          $set: {
            reliability: { $max: [0, { $subtract: ["$reliability", 0.02] }] },
            cooldownUntil: nowPlus(backoff),
          },
        },
      ]),
      models.NodeDailyMetrics.updateOne(
        { nodeId: node.nodeId, day },
        { $inc: { rejected: 1, failed: 1 } },
        { upsert: true }
      ),
    ]);
    return { accepted: false, errorCode };
  }

  async nack(node, leaseId, errorCode = "WORKER_ERROR") {
    const job = await models.ComputeJob.findOne({ leaseId, leasedTo: node.nodeId, status: "LEASED" });
    if (!job) throw Object.assign(new Error("invalid lease"), { statusCode: 409 });
    return this.reject(job, node, leaseId, errorCode);
  }

  async reap() {
    const jobs = await models.ComputeJob.find({ status: "LEASED", leaseExpiresAt: { $lte: new Date() } });
    for (const job of jobs) await this.reject(job, { nodeId: job.leasedTo }, job.leaseId, "LEASE_EXPIRED");
    await models.ComputeJob.updateMany({ deletePayloadAt: { $lte: new Date() } }, { $unset: { payload: 1 } });
    return jobs.length;
  }
}

module.exports = DurableQueue;
