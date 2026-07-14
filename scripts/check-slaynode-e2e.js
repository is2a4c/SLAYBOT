require("dotenv").config();
require("module-alias/register");
const assert = require("node:assert/strict");
const { spawn } = require("child_process");
const mongoose = require("mongoose");
const sharp = require("sharp");
const models = require("../src/database/schemas/slaynode");
const { createControlPlane, createEnrollment } = require("../src/slaynode/control/server");
const { JOB_TYPES, PRIVACY } = require("../src/slaynode/protocol");
const ControlClient = require("../src/slaynode/control/client");

const port = Number(process.env.SLAYNODE_E2E_PORT) || 18090;
process.env.SLAYNODE_MASTER_KEY ||= "e2e-only-master-key-at-least-32-characters";

async function waitFor(predicate, timeoutMs, message) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(message);
}

(async () => {
  let server;
  let worker;
  let memoryMongo;
  try {
    let mongo = process.env.SLAYNODE_E2E_MONGO;
    if (!mongo) {
      const { MongoMemoryReplSet } = require("mongodb-memory-server");
      memoryMongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
      mongo = memoryMongo.getUri("slaynode-e2e");
    }
    await mongoose.connect(mongo, { serverSelectionTimeoutMS: 10_000 });
    await mongoose.connection.dropDatabase();
    await Promise.all(Object.values(models).map((model) => model.init()));

    const control = createControlPlane({
      leaseMs: 15_000,
      verificationRate: 1,
      generalPoolDelayMs: 50,
      exposeErrors: true,
    });
    server = control.app.listen(port, "127.0.0.1");
    await new Promise((resolve, reject) => server.once("listening", resolve).once("error", reject));

    const guildId = "e2e-guild";
    const token = await createEnrollment({ ownerId: "e2e-owner", guildId, name: "E2E Worker" });
    const enrollment = await fetch(`http://127.0.0.1:${port}/v1/enroll`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token,
        protocolVersion: "1.0",
        workerVersion: "e2e",
        workerDigest: "e2e-digest",
        capabilities: [JOB_TYPES.IMAGE_PREPARE, JOB_TYPES.CANARY_SHA256],
        resources: { cpu: 1, ramMb: 512, gpu: false, parallelism: 1 },
      }),
    });
    const identity = await enrollment.json();
    assert.equal(enrollment.status, 201, JSON.stringify(identity));
    worker = spawn(process.execPath, [require.resolve("../slaynode/worker")], {
      cwd: process.cwd(),
      stdio: ["ignore", "inherit", "inherit"],
      env: {
        ...process.env,
        SLAYNODE_CONTROL_URL: `http://127.0.0.1:${port}`,
        SLAYNODE_ID: identity.nodeId,
        SLAYNODE_SECRET: identity.secret,
        SLAYNODE_PARALLELISM: "1",
        SLAYNODE_RAM_MB: "1024",
        SLAYNODE_JOB_TIMEOUT_MS: "120000",
      },
    });
    await waitFor(
      () => models.Node.exists({ nodeId: identity.nodeId, status: "ONLINE" }),
      20_000,
      "worker did not become online"
    );
    await Promise.all([
      models.PrivacyPolicy.create({
        guildId,
        allowGuildPrivate: true,
        allowGeneralPool: false,
        allowedJobTypes: [JOB_TYPES.IMAGE_PREPARE],
      }),
      models.Node.updateOne({ nodeId: identity.nodeId }, { $addToSet: { privacyClasses: PRIVACY.GUILD_PRIVATE } }),
    ]);

    const image = await sharp({ create: { width: 32, height: 24, channels: 3, background: "#8844cc" } })
      .png()
      .toBuffer();
    const job = await control.queue.enqueue({
      type: JOB_TYPES.IMAGE_PREPARE,
      privacyClass: PRIVACY.GUILD_PRIVATE,
      guildId,
      payload: { imageBase64: image.toString("base64") },
      idempotencyKey: "e2e-image-prepare",
      deadlineAt: new Date(Date.now() + 30_000),
    });
    let completed;
    try {
      completed = await waitFor(
        () => models.ComputeJob.findOne({ jobId: job.jobId, status: "SUCCEEDED" }),
        150_000,
        "image job did not complete"
      );
    } catch (error) {
      const [failedJob, attempts] = await Promise.all([
        models.ComputeJob.findOne({ jobId: job.jobId }),
        models.ComputeJobAttempt.find({ jobId: job.jobId }).lean(),
      ]);
      throw new Error(
        `${error.message}: status=${failedJob?.status} code=${failedJob?.errorCode} attempts=${JSON.stringify(attempts)}`
      );
    }
    assert.equal(completed.result.visual.width, 32);
    assert.equal(completed.result.visual.height, 24);
    assert.equal(completed.result.ocrImages.length, 5);

    const [ledger, account, attempt] = await Promise.all([
      models.CreditLedgerEntry.findOne({ jobId: job.jobId }),
      models.GuildPartnerAccount.findOne({ guildId }),
      models.ComputeJobAttempt.findOne({ jobId: job.jobId, status: "ACKED" }),
    ]);
    assert.ok(ledger.amountMicros > 0);
    assert.equal(account.cachedBalanceMicros, ledger.amountMicros);

    const signedClient = new ControlClient({ baseUrl: `http://127.0.0.1:${port}`, ...identity });
    await assert.rejects(() => signedClient.ack(attempt.leaseId, completed.result, 1), /invalid or expired lease/);
    assert.equal(await models.CreditLedgerEntry.countDocuments({ jobId: job.jobId }), 1);

    worker.kill("SIGTERM");
    await new Promise((resolve) => worker.once("exit", resolve));
    worker = null;

    const retryJob = await control.queue.enqueue({
      type: JOB_TYPES.CANARY_SHA256,
      privacyClass: PRIVACY.PUBLIC,
      targetNodeId: identity.nodeId,
      payload: { value: "retry" },
      idempotencyKey: "e2e-retry",
      deadlineAt: new Date(Date.now() + 30_000),
    });
    const node = await models.Node.findOne({ nodeId: identity.nodeId });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const retryLease = await control.queue.lease(node);
    assert.equal(retryLease.jobId, retryJob.jobId);
    await control.queue.nack(node, retryLease.leaseId, "E2E_FORCED_FAILURE");
    const retried = await models.ComputeJob.findOne({ jobId: retryJob.jobId });
    assert.equal(retried.status, "QUEUED");
    assert.equal(retried.attempts, 1);

    console.log(
      JSON.stringify({ ok: true, nodeId: identity.nodeId, jobId: job.jobId, creditsMicros: ledger.amountMicros })
    );
  } finally {
    if (worker) worker.kill("SIGTERM");
    if (server) await new Promise((resolve) => server.close(resolve));
    await mongoose.disconnect();
    if (memoryMongo) await memoryMongo.stop();
  }
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
