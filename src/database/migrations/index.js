const { resolveColor } = require("discord.js");

/**
 * One-off data repairs, run at startup.
 *
 * Settings that Discord has to parse used to be stored unchecked, so a server
 * could save something that only fails later — an embed colour that throws when
 * the greeting is built, for instance. The panels now refuse those values, but
 * whatever was saved before is still in the database. These clear the unusable
 * ones back to null, which every reader already treats as "use the default".
 */

const COLOR_PATHS = [
  "welcome.embed.color",
  "farewell.embed.color",
  "branding.color",
  "verification.color",
  "birthdays.color",
  "starboard.color",
];

const URL_PATHS = ["welcome.embed.image", "farewell.embed.image", "branding.iconURL"];

/**
 * Whether discord.js can turn this into an embed colour. Names such as "Red" are
 * valid, so this asks the library rather than matching a pattern.
 *
 * @param {*} value
 * @returns {boolean}
 */
function isUsableColor(value) {
  if (value === null || value === undefined || value === "") return true;

  try {
    resolveColor(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {*} value
 * @returns {boolean}
 */
function isUsableUrl(value) {
  if (value === null || value === undefined || value === "") return true;

  try {
    return new URL(String(value)).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * @param {object} target
 * @param {string} path dotted
 */
function readPath(target, path) {
  return path.split(".").reduce((value, key) => value?.[key], target);
}

/**
 * Decide what to clear for one guild document.
 *
 * Pure, so the rules are testable without a database.
 *
 * @param {object} document a lean guild document
 * @returns {string[]} paths that hold something unusable
 */
function unusablePaths(document) {
  const broken = [];

  for (const path of COLOR_PATHS) {
    if (!isUsableColor(readPath(document, path))) broken.push(path);
  }
  for (const path of URL_PATHS) {
    if (!isUsableUrl(readPath(document, path))) broken.push(path);
  }

  return broken;
}

/**
 * Clear settings no reader can use.
 *
 * @param {object} model the guild model
 * @param {{logger?: object}} [options]
 * @returns {Promise<{scanned: number, repaired: number, cleared: Record<string, number>}>}
 */
async function clearUnusableAppearance(model, { logger } = {}) {
  const projection = [...COLOR_PATHS, ...URL_PATHS].reduce((fields, path) => ({ ...fields, [path]: 1 }), {});
  const documents = await model.find({}, projection).lean();

  const operations = [];
  const cleared = {};

  for (const document of documents) {
    const broken = unusablePaths(document);
    if (!broken.length) continue;

    for (const path of broken) cleared[path] = (cleared[path] || 0) + 1;

    operations.push({
      updateOne: {
        filter: { _id: document._id },
        update: { $set: broken.reduce((set, path) => ({ ...set, [path]: null }), {}) },
      },
    });
  }

  if (operations.length) {
    await model.bulkWrite(operations, { ordered: false });

    const summary = Object.entries(cleared)
      .map(([path, count]) => `${path}: ${count}`)
      .join(", ");
    logger?.warn?.(`Cleared appearance settings Discord cannot parse on ${operations.length} server(s) — ${summary}`);
  }

  return { scanned: documents.length, repaired: operations.length, cleared };
}

/**
 * @param {import('discord.js').Client} [client]
 * @returns {Promise<object>}
 */
async function runMigrations(client) {
  const { model } = require("@schemas/Guild");

  return clearUnusableAppearance(model, { logger: client?.logger });
}

module.exports = {
  COLOR_PATHS,
  URL_PATHS,
  clearUnusableAppearance,
  isUsableColor,
  isUsableUrl,
  runMigrations,
  unusablePaths,
};
