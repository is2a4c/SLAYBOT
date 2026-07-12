require("module-alias/register");

const fs = require("fs");
const path = require("path");
const { classifyImageBuffer, DEFAULT_THRESHOLD } = require("@src/services/imageSpamClassifier");

const imagePath = process.argv[2];
const caption = process.argv[3] || "";
const threshold = Number(process.argv[4] || DEFAULT_THRESHOLD);

if (!imagePath) {
  console.error('Usage: npm run image-spam:check -- "/path/to/image.jpg" "caption" [threshold]');
  process.exit(2);
}

if (!Number.isFinite(threshold) || threshold < 50 || threshold > 100) {
  console.error("Threshold must be from 50 to 100");
  process.exit(2);
}

async function main() {
  const absolutePath = path.resolve(imagePath);
  const result = await classifyImageBuffer({
    buffer: fs.readFileSync(absolutePath),
    caption,
    threshold,
  });

  console.log(JSON.stringify({ image: absolutePath, caption, ...result }, null, 2));
  process.exit(0);
}

main().catch((error) => {
  console.error(`Analysis failed open: ${error.message}`);
  process.exit(1);
});
