const express = require("express");
const router = express.Router();
const { getSettings } = require("@schemas/Guild");
const { applyGuildConfigPatch } = require("@src/services/dashboard/guildConfig");
const { requireCsrf } = require("../../auth/csrf");
const {
  ACTIONS,
  AutomodEscalationError,
  addEscalationRule,
  createEscalationRule,
  removeEscalationRule,
} = require("@src/services/automodEscalation");

const SNOWFLAKE = /^\d{17,20}$/;
const VALID_ACTIONS = ["TIMEOUT", "KICK", "BAN"];
const FILTER_MODES = ["CONTAINS", "WORD", "EXACT"];
const LINK_MODES = ["ALL", "ALLOWLIST", "BLOCKLIST"];

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
    escalationActions: ACTIONS,
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
    "automod.anti_caps": body.anti_caps === "on",
    "automod.caps_min_letters": clampInt(body.caps_min_letters, 1, 1000, 8),
    "automod.caps_percent": clampInt(body.caps_percent, 10, 100, 75),
    "automod.anti_emoji": body.anti_emoji === "on",
    "automod.max_emoji": clampInt(body.max_emoji, 1, 100, 12),
    "automod.anti_zalgo": body.anti_zalgo === "on",
    "automod.zalgo_percent": clampInt(body.zalgo_percent, 1, 100, 30),
    "automod.anti_scam": body.anti_scam === "on",
    "automod.reset_strikes_on_action": body.reset_strikes_on_action === "on",
    "automod.debug": body.debug === "on",
    "automod.filter_enabled": body.filter_enabled === "on",
    "automod.filter_terms": String(body.filter_terms || "").slice(0, 4000),
    "automod.filter_exceptions": String(body.filter_exceptions || "").slice(0, 4000),
    "automod.filter_match_mode": FILTER_MODES.includes(body.filter_match_mode) ? body.filter_match_mode : "CONTAINS",
    "automod.filter_case_sensitive": body.filter_case_sensitive === "on",
    "automod.filter_delete": body.filter_delete === "on",
    "automod.filter_strikes": clampInt(body.filter_strikes, 0, 10, 1),
    "automod.spam_window_seconds": clampInt(body.spam_window_seconds, 1, 300, 3),
    "automod.spam_max_repeats": clampInt(body.spam_max_repeats, 2, 20, 2),
    "automod.link_mode": LINK_MODES.includes(body.link_mode) ? body.link_mode : "ALL",
    "automod.link_domains": String(body.link_domains || "").slice(0, 4000),
    "automod.allowed_invite_codes": String(body.allowed_invite_codes || "").slice(0, 4000),
    "automod.image_spam_threshold": clampInt(body.image_spam_threshold, 50, 100, 70),
    "automod.anti_massmention": clampInt(body.anti_massmention, 0, 50, 0),
    "automod.max_lines": clampInt(body.max_lines, 0, 50, 0),
    "automod.max_mentions": clampInt(body.max_mentions, 1, 50, 5),
    "automod.max_role_mentions": clampInt(body.max_role_mentions, 0, 20, 3),
    "automod.spam_whitelist_roles": parseIdList(body.spam_whitelist_roles, (id) => guild.roles.cache.has(id)),
    "automod.spam_whitelist_users": parseIdList(body.spam_whitelist_users, () => true),
    "automod.wh_channels": parseIdList(body.wh_channels, (id) => {
      const channel = guild.channels.cache.get(id);
      return channel?.isTextBased() && !channel.isThread();
    }),
  };

  await applyGuildConfigPatch(guild, patch, {
    id: req.session.user.id,
    tag: req.session.user.username,
    action: "automod_config_update",
    reason: "Dashboard: настройки Automod",
  });

  res.redirect(`${res.locals.basePath}/g/${guild.id}/automod?notice=saved`);
});

router.post("/escalations", requireCsrf, async (req, res) => {
  const redirect = `${res.locals.basePath}/g/${req.guild.id}/automod`;
  try {
    const settings = await getSettings(req.guild);
    const rule = createEscalationRule(req.body);
    const next = addEscalationRule(settings.automod.escalation_rules, rule);
    await applyGuildConfigPatch(
      req.guild,
      { "automod.escalation_rules": next },
      {
        id: req.session.user.id,
        tag: req.session.user.username,
        action: "automod_escalation_create",
        reason: `Dashboard: create ${rule.action} escalation at ${rule.threshold} strikes`,
      }
    );
    return res.redirect(`${redirect}?notice=created`);
  } catch (error) {
    const message = error instanceof AutomodEscalationError ? error.message : res.locals.t("errors.internalMessage");
    if (!(error instanceof AutomodEscalationError)) req.client.logger.error("automod escalation create failed", error);
    return res.redirect(`${redirect}?error=${encodeURIComponent(message)}`);
  }
});

router.post("/escalations/:id/delete", requireCsrf, async (req, res) => {
  const redirect = `${res.locals.basePath}/g/${req.guild.id}/automod`;
  if (!/^[a-f\d-]{36}$/i.test(req.params.id)) return res.redirect(`${redirect}?error=Invalid%20rule`);
  const settings = await getSettings(req.guild);
  const next = removeEscalationRule(settings.automod.escalation_rules, req.params.id);
  await applyGuildConfigPatch(
    req.guild,
    { "automod.escalation_rules": next },
    {
      id: req.session.user.id,
      tag: req.session.user.username,
      action: "automod_escalation_delete",
      reason: "Dashboard: delete automod escalation",
    }
  );
  return res.redirect(`${redirect}?notice=deleted`);
});

module.exports = router;
