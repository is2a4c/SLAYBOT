const express = require("express");
const crypto = require("crypto");
const models = require("../../database/schemas/slaynode");
const DurableQueue = require("./queue");
const { verify } = require("../protocol/auth");
const { hash, encrypt, decrypt } = require("./credentials");
const { DISTRIBUTABLE_TYPES, PROTOCOL_VERSION } = require("../protocol");

const auditExpiry = () => new Date(Date.now() + 30 * 86400_000);
const cleanName = (value) =>
  String(value || "SlayNode")
    .replace(/[^\w .-]/g, "")
    .slice(0, 64) || "SlayNode";

async function createEnrollment({ ownerId, guildId, name, ttlMs = 15 * 60_000 }) {
  const token = crypto.randomBytes(32).toString("base64url");
  await models.NodeEnrollment.create({
    tokenHash: hash(token),
    ownerId,
    guildId,
    name: cleanName(name),
    expiresAt: new Date(Date.now() + ttlMs),
  });
  return token;
}

async function rotateCredential(nodeId) {
  const secret = crypto.randomBytes(32).toString("base64url");
  const node = await models.Node.findOneAndUpdate(
    { nodeId, status: { $ne: "REVOKED" } },
    {
      $set: { credentialHash: hash(secret), credentialEncrypted: encrypt(secret), lastNonces: [] },
      $inc: { credentialVersion: 1 },
    },
    { new: true }
  );
  if (!node) throw Object.assign(new Error("node not found"), { statusCode: 404 });
  return secret;
}

function createControlPlane(options = {}) {
  if (!process.env.SLAYNODE_MASTER_KEY || process.env.SLAYNODE_MASTER_KEY.length < 32)
    throw new Error("SLAYNODE_MASTER_KEY must contain at least 32 characters");
  const app = express();
  const queue = options.queue || new DurableQueue(options);
  app.disable("x-powered-by");
  app.use(express.json({ limit: options.maxPayload || "9mb", strict: true }));
  const rate = new Map();
  app.use((req, res, next) => {
    const key = `${req.ip}:${req.headers["x-slay-node-id"] || "anonymous"}`;
    const current = rate.get(key);
    const now = Date.now();
    if (!current || current.resetAt <= now) rate.set(key, { count: 1, resetAt: now + 60_000 });
    else if (++current.count > (req.path === "/v1/enroll" ? 10 : 240))
      return res.status(429).json({ error: "rate limit exceeded" });
    next();
  });

  app.get("/health", (_req, res) => res.json({ ok: true }));
  app.get("/ready", (_req, res) =>
    res
      .status(require("mongoose").connection.readyState === 1 ? 200 : 503)
      .json({ ready: require("mongoose").connection.readyState === 1 })
  );

  app.post("/v1/enroll", async (req, res, next) => {
    try {
      if (!req.body || !Array.isArray(req.body.capabilities))
        return res.status(400).json({ error: "capabilities must be an array" });
      const capabilities = [...new Set(req.body.capabilities)];
      if (capabilities.some((capability) => !DISTRIBUTABLE_TYPES.has(capability)))
        return res.status(400).json({ error: "unsupported capability" });
      if (req.body.protocolVersion && req.body.protocolVersion !== PROTOCOL_VERSION)
        return res.status(400).json({ error: "unsupported protocol version" });
      if (options.allowedWorkerDigests?.length && !options.allowedWorkerDigests.includes(req.body.workerDigest))
        return res.status(403).json({ error: "worker digest is not approved" });
      const enrollment = await models.NodeEnrollment.findOneAndUpdate(
        { tokenHash: hash(req.body.token || ""), usedAt: null, expiresAt: { $gt: new Date() } },
        { $set: { usedAt: new Date() } },
        { new: true }
      );
      if (!enrollment) return res.status(401).json({ error: "invalid enrollment token" });
      const secret = crypto.randomBytes(32).toString("base64url");
      const nodeId = crypto.randomUUID();
      await models.Node.create({
        nodeId,
        ownerId: enrollment.ownerId,
        name: enrollment.name,
        guildIds: enrollment.guildId ? [enrollment.guildId] : [],
        credentialHash: hash(secret),
        credentialEncrypted: encrypt(secret),
        capabilities,
        resources: req.body.resources || {},
        workerVersion: req.body.workerVersion,
        workerDigest: req.body.workerDigest,
      });
      await models.AuditEvent.create({
        eventId: crypto.randomUUID(),
        actorType: "ENROLLMENT",
        actorId: enrollment.ownerId,
        nodeId,
        guildId: enrollment.guildId,
        action: "NODE_ENROLLED",
        outcome: "SUCCESS",
        expiresAt: auditExpiry(),
      });
      res.status(201).json({ nodeId, secret, protocolVersion: "1.0" });
    } catch (error) {
      next(error);
    }
  });

  app.use("/v1/node", async (req, res, next) => {
    try {
      const node = await models.Node.findOne({
        nodeId: req.headers["x-slay-node-id"],
        status: { $ne: "REVOKED" },
      }).select("+credentialEncrypted +lastNonces");
      if (!node || !verify(decrypt(node.credentialEncrypted), req))
        return res.status(401).json({ error: "invalid node signature" });
      const nonce = req.headers["x-slay-nonce"];
      const claimed = await models.Node.updateOne(
        {
          _id: node._id,
          status: { $ne: "REVOKED" },
          credentialVersion: node.credentialVersion,
          lastNonces: { $ne: nonce },
        },
        { $push: { lastNonces: { $each: [nonce], $slice: -100 } } }
      );
      if (!claimed.modifiedCount) return res.status(409).json({ error: "replayed nonce" });
      req.slayNode = node;
      next();
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/node/heartbeat", async (req, res, next) => {
    try {
      const heartbeatAt = new Date();
      const elapsed = req.slayNode.lastHeartbeatAt
        ? Math.min(60, Math.max(0, (heartbeatAt - req.slayNode.lastHeartbeatAt) / 1000))
        : 0;
      await models.Node.updateOne(
        { _id: req.slayNode._id },
        {
          $set: {
            status: "ONLINE",
            lastHeartbeatAt: heartbeatAt,
            load: req.body.load || {},
            latencyMs: req.body.latencyMs || 0,
          },
        }
      );
      if (elapsed) {
        const day = new Date();
        day.setUTCHours(0, 0, 0, 0);
        await models.NodeDailyMetrics.updateOne(
          { nodeId: req.slayNode.nodeId, day },
          { $inc: { uptimeSeconds: elapsed }, $setOnInsert: { guildId: req.slayNode.guildIds[0] } },
          { upsert: true }
        );
      }
      res.json({ ok: true, serverTime: Date.now() });
    } catch (e) {
      next(e);
    }
  });
  app.post("/v1/node/lease", async (req, res, next) => {
    try {
      const job = await queue.lease(req.slayNode);
      res.json({ job: job ? job.toObject({ versionKey: false }) : null });
    } catch (e) {
      next(e);
    }
  });
  app.post("/v1/node/ack", async (req, res, next) => {
    try {
      res.json(await queue.complete(req.slayNode, req.body.leaseId, req.body.result, req.body.executionMs));
    } catch (e) {
      next(e);
    }
  });
  app.post("/v1/node/nack", async (req, res, next) => {
    try {
      res.json(
        await queue.nack(req.slayNode, req.body.leaseId, String(req.body.errorCode || "WORKER_ERROR").slice(0, 64))
      );
    } catch (e) {
      next(e);
    }
  });
  app.get("/metrics", async (_req, res, next) => {
    try {
      const [nodes, jobs, privacy, attempts, credits, versions, latency] = await Promise.all([
        models.Node.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
        models.ComputeJob.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
        models.ComputeJob.aggregate([{ $group: { _id: "$privacyClass", count: { $sum: 1 } } }]),
        models.ComputeJobAttempt.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
        models.CreditLedgerEntry.aggregate([{ $group: { _id: null, total: { $sum: "$amountMicros" } } }]),
        models.Node.aggregate([{ $group: { _id: "$workerVersion", count: { $sum: 1 } } }]),
        models.ComputeJobAttempt.aggregate([
          { $match: { status: "ACKED" } },
          { $group: { _id: null, executionTotal: { $sum: "$latencyMs" }, count: { $sum: 1 } } },
        ]),
      ]);
      res
        .type("text/plain")
        .send(
          [
            ...nodes.map((x) => `slaynode_nodes{status="${x._id}"} ${x.count}`),
            ...jobs.map((x) => `slaynode_jobs{status="${x._id}"} ${x.count}`),
            ...privacy.map((x) => `slaynode_jobs_privacy{class="${x._id}"} ${x.count}`),
            ...attempts.map((x) => `slaynode_attempts{status="${x._id}"} ${x.count}`),
            ...versions.map((x) => `slaynode_worker_versions{version="${x._id || "unknown"}"} ${x.count}`),
            `slaynode_credits_issued_micros ${credits[0]?.total || 0}`,
            `slaynode_execution_latency_ms_total ${latency[0]?.executionTotal || 0}`,
            `slaynode_accepted_results ${latency[0]?.count || 0}`,
          ].join("\n") + "\n"
        );
    } catch (e) {
      next(e);
    }
  });
  app.use((error, _req, res, _next) =>
    res
      .status(error.statusCode || 500)
      .json({ error: error.statusCode || options.exposeErrors ? error.message : "internal error" })
  );
  return { app, queue, createEnrollment };
}

module.exports = { createControlPlane, createEnrollment, rotateCredential };
