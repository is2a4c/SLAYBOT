const express = require("express");
const router = express.Router();
const { logAudit } = require("@src/services/dashboard/auditLog");
const { requireCsrf } = require("../../auth/csrf");
const {
  SUPPORTED_TYPES,
  SubscriptionError,
  createSubscription,
  deleteSubscription,
  listSubscriptions,
  setSubscriptionEnabled,
} = require("../../services/subscriptions");

const validId = (value) => /^[a-f\d]{24}$/i.test(String(value || ""));
const backTo = (res, guildId) => `${res.locals.basePath}/g/${guildId}/subscriptions`;

function options(guild) {
  return {
    channels: [...guild.channels.cache.filter((entry) => entry.isTextBased?.() && !entry.isThread?.()).values()],
    roles: [...guild.roles.cache.filter((entry) => entry.id !== guild.id && !entry.managed).values()],
  };
}

router.get("/", async (req, res) => {
  const subscriptions = await listSubscriptions(req.guild.id);
  res.render("guild/subscriptions", {
    title: `${res.locals.t("subscriptions.title")} — ${req.guild.name}`,
    guild: req.guild,
    subscriptions,
    providers: SUPPORTED_TYPES,
    options: options(req.guild),
    error: typeof req.query.error === "string" ? req.query.error : null,
  });
});

router.post("/", requireCsrf, async (req, res) => {
  const redirect = backTo(res, req.guild.id);
  try {
    const feed = await createSubscription(req.guild, req.body, req.session.user.id);
    await logAudit({
      actorId: req.session.user.id,
      actorTag: req.session.user.username,
      action: "subscription_create",
      guildId: req.guild.id,
      targetType: "feed",
      targetId: String(feed._id),
      after: { type: feed.type, target: feed.target, channelId: feed.channel_id },
    });
    return res.redirect(`${redirect}?notice=created`);
  } catch (error) {
    if (!(error instanceof SubscriptionError)) req.client.logger.error("dashboard subscription create failed", error);
    const message = error instanceof SubscriptionError ? error.message : res.locals.t("errors.internalMessage");
    return res.redirect(`${redirect}?error=${encodeURIComponent(message)}`);
  }
});

router.post("/:id/toggle", requireCsrf, async (req, res) => {
  const redirect = backTo(res, req.guild.id);
  if (!validId(req.params.id))
    return res.redirect(`${redirect}?error=${encodeURIComponent("Invalid subscription id.")}`);
  try {
    const feed = await setSubscriptionEnabled(req.guild.id, req.params.id, req.body.enabled === "true");
    await logAudit({
      actorId: req.session.user.id,
      actorTag: req.session.user.username,
      action: "subscription_toggle",
      guildId: req.guild.id,
      targetType: "feed",
      targetId: req.params.id,
      after: { enabled: feed.enabled },
    });
    return res.redirect(`${redirect}?notice=saved`);
  } catch (error) {
    const message = error instanceof SubscriptionError ? error.message : res.locals.t("errors.internalMessage");
    return res.redirect(`${redirect}?error=${encodeURIComponent(message)}`);
  }
});

router.post("/:id/delete", requireCsrf, async (req, res) => {
  const redirect = backTo(res, req.guild.id);
  if (!validId(req.params.id))
    return res.redirect(`${redirect}?error=${encodeURIComponent("Invalid subscription id.")}`);
  try {
    await deleteSubscription(req.guild.id, req.params.id);
    await logAudit({
      actorId: req.session.user.id,
      actorTag: req.session.user.username,
      action: "subscription_delete",
      guildId: req.guild.id,
      targetType: "feed",
      targetId: req.params.id,
    });
    return res.redirect(`${redirect}?notice=deleted`);
  } catch (error) {
    const message = error instanceof SubscriptionError ? error.message : res.locals.t("errors.internalMessage");
    return res.redirect(`${redirect}?error=${encodeURIComponent(message)}`);
  }
});

module.exports = router;
