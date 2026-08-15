const express = require("express");
const router = express.Router();
const { getSettings } = require("@schemas/Guild");
const { getMemberStats, getXpLb } = require("@schemas/MemberStats");
const { applyGuildConfigPatch } = require("@src/services/dashboard/guildConfig");
const { logAudit } = require("@src/services/dashboard/auditLog");
const { requireCsrf } = require("../../auth/csrf");
const { RankingError, addReward, createReward, parseMemberStats, removeReward } = require("../../services/ranking");
const { buildRankCardUrl, fetchRankCard } = require("@src/services/stats/RankCard");
const { normalizedBaseURL } = require("../../app");

const backTo = (res, guildId) => `${res.locals.basePath}/g/${guildId}/ranking`;
const COLOR = /^#[0-9a-f]{6}$/i;
const HTTPS = /^https:\/\//i;

router.get("/", async (req, res) => {
  const [settings, leaderboard] = await Promise.all([getSettings(req.guild), getXpLb(req.guild.id, 100)]);
  const config = req.client.config.DASHBOARD;
  res.render("guild/ranking", {
    title: `${res.locals.t("ranking.title")} — ${req.guild.name}`,
    guild: req.guild,
    settings,
    leaderboard: leaderboard.map((entry) => ({
      ...entry,
      member: req.guild.members.cache.get(entry.member_id) || null,
    })),
    roles: [...req.guild.roles.cache.filter((entry) => entry.id !== req.guild.id && !entry.managed).values()],
    error: typeof req.query.error === "string" ? req.query.error : null,
    publicUrl: `${normalizedBaseURL(config.baseURL)}${res.locals.basePath}/g/${req.guild.id}/ranking/public`,
  });
});

router.post("/rewards", requireCsrf, async (req, res) => {
  const redirect = backTo(res, req.guild.id);
  try {
    const settings = await getSettings(req.guild);
    const { type, reward } = createReward(req.guild, req.body);
    const path = `stats.rewards.${type}`;
    const next = addReward(settings.stats?.rewards?.[type], reward);
    await applyGuildConfigPatch(
      req.guild,
      { [path]: next },
      {
        id: req.session.user.id,
        tag: req.session.user.username,
        action: "ranking_reward_create",
        reason: `Dashboard: create ${type} role reward`,
      }
    );
    return res.redirect(`${redirect}?notice=created`);
  } catch (error) {
    const message = error instanceof RankingError ? error.message : res.locals.t("errors.internalMessage");
    if (!(error instanceof RankingError)) req.client.logger.error("dashboard ranking reward create failed", error);
    return res.redirect(`${redirect}?error=${encodeURIComponent(message)}`);
  }
});

router.post("/rewards/:type/:id/delete", requireCsrf, async (req, res) => {
  const redirect = backTo(res, req.guild.id);
  try {
    const type = req.params.type === "voice" ? "voice" : req.params.type === "level" ? "level" : null;
    if (!type || !/^[a-f\d-]{36}$/i.test(req.params.id)) throw new RankingError("Invalid reward.");
    const settings = await getSettings(req.guild);
    const path = `stats.rewards.${type}`;
    const next = removeReward(settings.stats?.rewards?.[type], req.params.id);
    await applyGuildConfigPatch(
      req.guild,
      { [path]: next },
      {
        id: req.session.user.id,
        tag: req.session.user.username,
        action: "ranking_reward_delete",
        reason: `Dashboard: delete ${type} role reward`,
      }
    );
    return res.redirect(`${redirect}?notice=deleted`);
  } catch (error) {
    const message = error instanceof RankingError ? error.message : res.locals.t("errors.internalMessage");
    return res.redirect(`${redirect}?error=${encodeURIComponent(message)}`);
  }
});

router.post("/members/:userId", requireCsrf, async (req, res) => {
  const redirect = backTo(res, req.guild.id);
  const userId = String(req.params.userId || "");
  try {
    if (!/^\d{17,20}$/.test(userId)) throw new RankingError("Invalid member id.");
    const member = req.guild.members.cache.get(userId) || (await req.guild.members.fetch(userId).catch(() => null));
    if (!member) throw new RankingError("Member is no longer on this server.");
    const values = parseMemberStats(req.body);
    const stats = await getMemberStats(req.guild.id, userId);
    const before = { level: stats.level, xp: stats.xp, voiceSeconds: stats.voice.time };
    stats.level = values.level;
    stats.xp = values.xp;
    stats.voice.time = values.voiceSeconds;
    await stats.save();
    await logAudit({
      actorId: req.session.user.id,
      actorTag: req.session.user.username,
      action: "ranking_member_update",
      guildId: req.guild.id,
      targetType: "member",
      targetId: userId,
      before,
      after: values,
      reason: "Dashboard: update member ranking",
    });
    return res.redirect(`${redirect}?notice=saved`);
  } catch (error) {
    const message = error instanceof RankingError ? error.message : res.locals.t("errors.internalMessage");
    if (!(error instanceof RankingError)) req.client.logger.error("dashboard ranking member update failed", error);
    return res.redirect(`${redirect}?error=${encodeURIComponent(message)}`);
  }
});

/**
 * A live preview of the rank card, built from whatever the accent/background
 * form fields currently hold - saved or not. The staff member viewing the
 * page is the sample subject, so the preview is a real card rather than a
 * placeholder silhouette.
 */
router.get("/preview.png", async (req, res) => {
  const accent = COLOR.test(String(req.query.accent || "")) ? req.query.accent : null;
  const background = HTTPS.test(String(req.query.background || "")) ? req.query.background : null;

  const sampleUser = await req.client.users.fetch(req.session.user.id).catch(() => null);
  if (!sampleUser) return res.status(404).end();

  const url = buildRankCardUrl({
    user: sampleUser,
    level: 5,
    xp: 420,
    xpNeeded: 1000,
    rank: 1,
    presenceStatus: "online",
    settings: { control_center: { ranking: { card_accent: accent, card_background: background } } },
  });

  const response = await fetchRankCard(url).catch(() => ({ success: false }));
  if (!response.success) return res.status(502).end();

  res.set("Content-Type", "image/png").set("Cache-Control", "no-store").send(response.buffer);
});

module.exports = router;
