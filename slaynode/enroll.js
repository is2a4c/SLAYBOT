require("dotenv").config();
const os = require("os");
(async () => {
  const response = await fetch(`${process.env.SLAYNODE_CONTROL_URL.replace(/\/$/, "")}/v1/enroll`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      token: process.env.SLAYNODE_ENROLLMENT_TOKEN,
      workerVersion: require("../package.json").version,
      workerDigest: process.env.SLAYNODE_WORKER_DIGEST || "development",
      capabilities: (
        process.env.SLAYNODE_CAPABILITIES ||
        "image.prepare.v1,image.ocr.v1,image.vision.v1,image.spam.v1,canary.sha256.v1"
      ).split(","),
      resources: {
        cpu: os.cpus().length,
        ramMb: Math.floor(os.totalmem() / 1048576),
        gpu: process.env.SLAYNODE_GPU === "true",
        parallelism: Number(process.env.SLAYNODE_PARALLELISM) || 1,
      },
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  console.log(JSON.stringify(data, null, 2));
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
