require("dotenv").config();
require("module-alias/register");

const mongoose = require("mongoose");
const { COLOR_PATHS, URL_PATHS, clearUnusableAppearance, unusablePaths } = require("@src/database/migrations");

/**
 * Clear embed colours and image URLs Discord cannot parse.
 *
 * The bot does this on startup too; this is for running it against a database
 * without starting the bot, and for seeing what would change first.
 *
 *   node scripts/fix-appearance-settings.js --dry-run
 *   node scripts/fix-appearance-settings.js
 */
async function main() {
  const dryRun = process.argv.includes("--dry-run");

  if (!process.env.MONGO_CONNECTION) {
    console.error("MONGO_CONNECTION is not set");
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_CONNECTION);
  const { model } = require("@schemas/Guild");

  console.log(`Checking ${COLOR_PATHS.length} colour and ${URL_PATHS.length} image settings on every server…`);

  if (dryRun) {
    const projection = [...COLOR_PATHS, ...URL_PATHS].reduce((fields, path) => ({ ...fields, [path]: 1 }), {});
    const documents = await model.find({}, projection).lean();
    const affected = documents
      .map((document) => ({ id: document._id, broken: unusablePaths(document) }))
      .filter((entry) => entry.broken.length);

    console.log(`Scanned ${documents.length} server(s); ${affected.length} would change:`);
    affected.forEach((entry) => console.log(`  ${entry.id}: ${entry.broken.join(", ")}`));
  } else {
    const result = await clearUnusableAppearance(model);

    console.log(`Scanned ${result.scanned} server(s); repaired ${result.repaired}.`);
    Object.entries(result.cleared).forEach(([path, count]) => console.log(`  ${path}: ${count}`));
  }

  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
