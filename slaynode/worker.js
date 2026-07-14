require("dotenv").config();
require("module-alias/register");
const { fork } = require("child_process");
const path = require("path");
const ControlClient = require("../src/slaynode/control/client");
const { PROTOCOL_VERSION } = require("../src/slaynode/protocol");

const parallelism = Math.max(1, Math.min(16, Number(process.env.SLAYNODE_PARALLELISM) || 1));
const timeoutMs = Math.max(5_000, Number(process.env.SLAYNODE_JOB_TIMEOUT_MS) || 120_000);
const client = new ControlClient({
  baseUrl: process.env.SLAYNODE_CONTROL_URL,
  nodeId: process.env.SLAYNODE_ID,
  secret: process.env.SLAYNODE_SECRET,
});
let stopping = false;
let running = 0;

function isolatedExecute(job) {
  return new Promise((resolve, reject) => {
    const child = fork(path.join(__dirname, "executor-child.js"), [], {
      stdio: ["ignore", "inherit", "inherit", "ipc"],
      env: { ...process.env, BOT_TOKEN: "", MONGO_CONNECTION: "", SLAYNODE_SECRET: "" },
      execArgv: [`--max-old-space-size=${Math.max(128, Number(process.env.SLAYNODE_RAM_MB) || 1024)}`],
    });
    let settled = false;
    let timer;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(reject, new Error("EXECUTION_TIMEOUT"));
    }, timeoutMs);
    child.once("message", (message) =>
      message.ok ? finish(resolve, message.result) : finish(reject, new Error(message.error))
    );
    child.once("error", (error) => finish(reject, error));
    child.once("exit", (code, signal) =>
      finish(reject, new Error(`executor exited before replying (code=${code} signal=${signal})`))
    );
    child.send({ type: job.type, payload: job.payload });
  });
}

async function runOne(job) {
  running += 1;
  const started = Date.now();
  try {
    const result = await isolatedExecute(job);
    await client.ack(job.leaseId, result, Date.now() - started);
  } catch (error) {
    console.error(
      JSON.stringify({ level: "error", event: "job_failed", jobId: job.jobId, type: job.type, message: error.message })
    );
    await client.nack(job.leaseId, String(error.message || "WORKER_ERROR").slice(0, 64)).catch(() => {});
  } finally {
    running -= 1;
    await client.heartbeat({ running }).catch(() => {});
  }
}
async function loop() {
  while (!stopping) {
    try {
      if (running < parallelism) {
        const { job } = await client.lease();
        if (job && job.protocolVersion === PROTOCOL_VERSION) {
          runOne(job);
          continue;
        }
      }
    } catch (error) {
      console.error(JSON.stringify({ level: "error", event: "worker_poll_failed", message: error.message }));
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
}
setInterval(() => client.heartbeat({ running }).catch(() => {}), 15_000).unref();
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, async () => {
    stopping = true;
    const deadline = Date.now() + 30_000;
    while (running && Date.now() < deadline) await new Promise((r) => setTimeout(r, 250));
    process.exit(running ? 1 : 0);
  });
if (!process.env.SLAYNODE_CONTROL_URL || !process.env.SLAYNODE_ID || !process.env.SLAYNODE_SECRET)
  throw new Error("SLAYNODE_CONTROL_URL, SLAYNODE_ID and SLAYNODE_SECRET are required");
client
  .heartbeat({ running })
  .catch(() => {})
  .finally(loop);
