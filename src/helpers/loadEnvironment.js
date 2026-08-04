const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

/**
 * Loads .env the way `dotenv.config()` does, minus one deployment trap.
 *
 * A deploy exports every secret it knows the name of - including the ones its
 * own secret store has no value for, which arrive as empty strings. dotenv
 * never overwrites a variable that is already set, so an exported empty string
 * silently beats the value the server keeps in .env and the bot starts as if
 * the secret were missing (SLAYNODE_MASTER_KEY doing exactly that is what this
 * exists for). An empty environment variable never means anything useful here,
 * so the ones .env has a real value for are dropped before the file is read.
 */
module.exports = function loadEnvironment(cwd = process.cwd()) {
  const file = path.resolve(cwd, ".env");
  if (fs.existsSync(file)) {
    for (const [key, value] of Object.entries(dotenv.parse(fs.readFileSync(file)))) {
      if (value !== "" && process.env[key] === "") delete process.env[key];
    }
  }
  return dotenv.config({ path: file });
};
