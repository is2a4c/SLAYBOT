const express = require("express");
const router = express.Router();
const { getSettings } = require("@schemas/Guild");
const { applyGuildConfigPatch } = require("@src/services/dashboard/guildConfig");
const { requireCsrf } = require("../../auth/csrf");

const SNOWFLAKE = /^\d{17,20}$/;
const VALID_ACTIONS = ["TIMEOUT", "KICK", "BAN"];

function parseIdList(raw, validate) {
  return String(raw || "")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => SNOWFLAKE.test(id) && validate(id))
    .slice(0, 25);
}

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

router.get("/", async (req, res) => {
  const { guild } = req;
  const settings = await getSettings(guild);
  res.render("guild/automod", {
    title: `Automod — ${guild.name}`,
    guild,
    settings,
    validActions: VALID_ACTIONS,
    roles: [...guild.roles.cache.filter((r) => r.id !== guild.id && !r.managed).values()],
  });
});

router.post("/", requireCsrf, async (req, res) => {
  const { guild } = req;
  const body = req.body;

  const patch = {
    "automod.action": VALID_ACTIONS.includes(body.action) ? body.action : "TIMEOUT",
    "automod.strikes": clampInt(body.strikes, 1, 100, 10),
    "automod.anti_links": body.anti_links === "on",
    "automod.anti_invites": body.anti_invites === "on",
    "automod.anti_attachments": body.anti_attachments === "on",
    "automod.anti_spam": body.anti_spam === "on",
    "automod.anti_ghostping": body.anti_ghostping === "on",
    "automod.anti_image_spam": body.anti_image_spam === "on",
    "automod.image_spam_threshold": clampInt(body.image_spam_threshold, 50, 100, 70),
    "automod.anti_massmention": clampInt(body.anti_massmention, 0, 50, 0),
    "automod.max_lines": clampInt(body.max_lines, 0, 50, 0),
    "automod.max_mentions": clampInt(body.max_mentions, 1, 50, 5),
    "automod.max_role_mentions": clampInt(body.max_role_mentions, 0, 20, 3),
    "automod.spam_whitelist_roles": parseIdList(body.spam_whitelist_roles, (id) => guild.roles.cache.has(id)),
    "automod.spam_whitelist_users": parseIdList(body.spam_whitelist_users, () => true),
  };

  await applyGuildConfigPatch(guild, patch, {
    id: req.session.user.id,
    tag: req.session.user.username,
    action: "automod_config_update",
    reason: "Dashboard: настройки Automod",
  });

  res.redirect(`/g/${guild.id}/automod`);
});

module.exports = router;
