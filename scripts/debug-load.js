#!/usr/bin/env node
/**
 * Debug script — loads all project files with full stack traces on error.
 * Usage: npm run debug:load
 *
 * Unlike CI smoke tests, this prints full error stacks for local debugging.
 */

require("module-alias/register");
require("@helpers/ConfigDefaults").applyConfigDefaults();

const { recursiveReadDirSync } = require("@helpers/Utils");

const dirs = ["src/database/schemas", "src/helpers", "src/events", "src/handlers", "src/commands"];

let total = 0;
let passed = 0;
let failed = 0;

for (const dir of dirs) {
  const files = recursiveReadDirSync(dir);
  total += files.length;

  for (const file of files) {
    try {
      // Clear cache for hot-reload style debugging
      delete require.cache[require.resolve(file)];
      require(file);
      passed++;
    } catch (ex) {
      failed++;
      console.error(`\n❌ FAILED: ${file}`);
      console.error(`   Error: ${ex.message}`);
      console.error(`   Stack:\n${ex.stack.split("\n").slice(1).join("\n")}`);
    }
  }
}

console.log(`\n${"=".repeat(50)}`);
console.log(`Total: ${total} | Passed: ${passed} | Failed: ${failed}`);
console.log("=".repeat(50));

if (failed > 0) process.exit(1);
process.exit(0);
