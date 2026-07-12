require("module-alias/register");

const { classifyImageBuffer } = require("@src/services/imageSpamClassifier");

async function main() {
  const encoded = process.env.IMAGE_SPAM_E2E_IMAGE;
  if (!encoded) throw new Error("IMAGE_SPAM_E2E_IMAGE is not configured");

  const result = await classifyImageBuffer({
    buffer: Buffer.from(encoded, "base64"),
    caption: "bro",
    threshold: 70,
  });
  console.log(JSON.stringify(result, null, 2));
  if (!result.risky) throw new Error(`expected risky image, received ${result.score}/100`);
  process.exit(0);
}

main().catch((error) => {
  console.error(`Image-spam end-to-end check failed: ${error.message}`);
  process.exit(1);
});
