#!/usr/bin/env node

require("module-alias/register");

const { readdirSync, lstatSync } = require("fs");
const { join, extname, relative } = require("path");
const { EmbedBuilder } = require("discord.js");
const { applyConfigDefaults } = require("@helpers/ConfigDefaults");

const config = applyConfigDefaults();
const ROOTS = [
  "AUTOMOD",
  "CACHE_SIZE",
  "DASHBOARD",
  "ECONOMY",
  "EMBED_COLORS",
  "GIVEAWAYS",
  "IMAGE",
  "INTERACTIONS",
  "INVITE",
  "MESSAGES",
  "MODERATION",
  "MUSIC",
  "PREFIX_COMMANDS",
  "PRESENCE",
  "STATS",
  "SMART_INVITES",
  "SUGGESTIONS",
  "TICKET",
];

const SOURCE_DIRS = [
  "src/commands",
  "src/contexts",
  "src/events",
  "src/handlers",
  "src/helpers",
  "src/services",
  "src/structures",
  "src/web",
];

function recursiveReadDir(dir) {
  const files = [];

  for (const file of readdirSync(dir)) {
    const filePath = join(dir, file);
    const stat = lstatSync(filePath);

    if (stat.isDirectory()) {
      files.push(...recursiveReadDir(filePath));
    } else if (extname(filePath) === ".js") {
      files.push(filePath);
    }
  }

  return files;
}

function getPath(target, path) {
  return path.split(".").reduce((value, key) => value?.[key], target);
}

function extractConfigPaths(source) {
  const paths = new Set();
  const rootPattern = ROOTS.join("|");
  const directPattern = new RegExp(`\\b(${rootPattern})\\.([A-Za-z0-9_]+(?:\\.[A-Za-z0-9_]+)*)`, "g");
  const clientPattern = new RegExp(
    `\\b(?:client|message\\.client|guild\\.client|interaction\\.client)\\.config\\.(${rootPattern})\\.([A-Za-z0-9_]+(?:\\.[A-Za-z0-9_]+)*)`,
    "g"
  );
  const configPattern = new RegExp(`\\bconfig\\.(${rootPattern})\\.([A-Za-z0-9_]+(?:\\.[A-Za-z0-9_]+)*)`, "g");

  for (const pattern of [directPattern, clientPattern, configPattern]) {
    for (const match of source.matchAll(pattern)) {
      paths.add(`${match[1]}.${match[2]}`);
    }
  }

  return paths;
}

const failures = [];
const files = SOURCE_DIRS.flatMap((dir) => recursiveReadDir(dir));

for (const file of files) {
  const source = require("fs").readFileSync(file, "utf8");

  for (const path of extractConfigPaths(source)) {
    if (getPath(config, path) === undefined) {
      failures.push(`${relative(process.cwd(), file)} references missing config path ${path}`);
    }
  }
}

const colorPaths = [
  "AUTOMOD.LOG_EMBED",
  "AUTOMOD.DM_EMBED",
  "EMBED_COLORS.BOT_EMBED",
  "EMBED_COLORS.ERROR",
  "EMBED_COLORS.WARNING",
  "EMBED_COLORS.SUCCESS",
  "EMBED_COLORS.GIVEAWAYS",
  "EMBED_COLORS.TRANSPARENT",
  "GIVEAWAYS.START_EMBED",
  "GIVEAWAYS.END_EMBED",
  "MODERATION.EMBED_COLORS.WARN",
  "SUGGESTIONS.DEFAULT_EMBED",
  "SUGGESTIONS.APPROVED_EMBED",
  "SUGGESTIONS.DENIED_EMBED",
  "TICKET.CREATE_EMBED",
  "TICKET.CLOSE_EMBED",
];

for (const path of colorPaths) {
  try {
    new EmbedBuilder().setColor(getPath(config, path));
  } catch (ex) {
    failures.push(`${path} is not accepted by EmbedBuilder.setColor(): ${ex.message}`);
  }
}

if (failures.length > 0) {
  console.error("Runtime config check failed:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(`Runtime config check passed for ${files.length} source files`);
