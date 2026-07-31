const express = require("express");
const router = express.Router();
const { SmartInviteService } = require("@src/services/smart-invites/SmartInviteService");
const SmartInviteError = require("@src/services/smart-invites/SmartInviteError");
const { publicInviteURL } = require("@src/services/smart-invites/config");
const { logAudit } = require("@src/services/dashboard/auditLog");
const { requireCsrf } = require("../../auth/csrf");

// Mirrors the fallback used by src/commands/invites/smart-invite.js: prefer the
// live service instance the runtime attaches to the client, otherwise construct
// one directly (and let assertEnabled() below reject writes if it's disabled).
function getService(client) {
  if (client.smartInvites) return client.smartInvites;
  if (client.config.SMART_INVITES.enabled) {
    throw new SmartInviteError("SERVICE_UNAVAILABLE", "SERVICE_UNAVAILABLE");
  }
  return new SmartInviteService(client);
}

function actorFromSession(req) {
  return { id: req.session.user.id, username: req.session.user.username };
}

router.get("/", async (req, res) => {
  const { guild } = req;
  try {
    const service = getService(req.client);
    const records = await service.listForGuild(guild.id);

    res.render("guild/smart-invites", {
      title: `Smart Invites — ${guild.name}`,
      guild,
      records: records.map((r) => ({ ...r, publicUrl: publicInviteURL(service.config, r.slug) })),
      enabled: req.client.config.SMART_INVITES.enabled,
      textChannels: [...guild.channels.cache.filter((c) => c.isTextBased() && !c.isThread()).values()],
      error: typeof req.query.error === "string" ? req.query.error : null,
    });
  } catch (ex) {
    const message = ex instanceof SmartInviteError
      ? res.locals.t("smartInvites.serviceUnavailable")
      : res.locals.t("smartInvites.serviceUnavailable");
    if (!(ex instanceof SmartInviteError)) req.client.logger.error("dashboard smart invite list failed", ex);
    res.render("guild/smart-invites", {
      title: `Smart Invites — ${guild.name}`,
      guild,
      records: [],
      enabled: false,
      textChannels: [],
      error: message,
    });
  }
});

router.post("/", requireCsrf, async (req, res) => {
  const { guild } = req;
  const backTo = `${res.locals.basePath}/g/${guild.id}/smart-invites`;
  try {
    const service = getService(req.client);
    service.assertEnabled();
    await service.create({
      guildId: guild.id,
      channelId: req.body.channelId,
      slug: req.body.slug,
      description: req.body.description || null,
      actor: actorFromSession(req),
    });
    await logAudit({
      actorId: req.session.user.id,
      actorTag: req.session.user.username,
      action: "smart_invite_create",
      guildId: guild.id,
      targetType: "smart_invite",
      targetId: req.body.slug,
      reason: "Dashboard: создание Smart Invite",
    });
    res.redirect(`${backTo}?notice=created`);
  } catch (ex) {
    const message = ex instanceof SmartInviteError ? ex.safeMessage : res.locals.t("smartInvites.createFailed");
    if (!(ex instanceof SmartInviteError)) req.client.logger.error("dashboard smart invite create failed", ex);
    res.redirect(`${backTo}?error=${encodeURIComponent(message)}`);
  }
});

router.post("/:slug/refresh", requireCsrf, async (req, res) => {
  const { guild } = req;
  const backTo = `${res.locals.basePath}/g/${guild.id}/smart-invites`;
  try {
    const service = getService(req.client);
    service.assertEnabled();
    await service.refresh(guild.id, req.params.slug, actorFromSession(req));
    await logAudit({
      actorId: req.session.user.id,
      actorTag: req.session.user.username,
      action: "smart_invite_refresh",
      guildId: guild.id,
      targetType: "smart_invite",
      targetId: req.params.slug,
    });
    res.redirect(`${backTo}?notice=refreshed`);
  } catch (ex) {
    const message = ex instanceof SmartInviteError ? ex.safeMessage : res.locals.t("smartInvites.refreshFailed");
    if (!(ex instanceof SmartInviteError)) req.client.logger.error("dashboard smart invite refresh failed", ex);
    res.redirect(`${backTo}?error=${encodeURIComponent(message)}`);
  }
});

router.post("/:slug/delete", requireCsrf, async (req, res) => {
  const { guild } = req;
  const backTo = `${res.locals.basePath}/g/${guild.id}/smart-invites`;
  try {
    const service = getService(req.client);
    service.assertEnabled();
    await service.softDelete(guild.id, req.params.slug);
    await logAudit({
      actorId: req.session.user.id,
      actorTag: req.session.user.username,
      action: "smart_invite_delete",
      guildId: guild.id,
      targetType: "smart_invite",
      targetId: req.params.slug,
    });
    res.redirect(`${backTo}?notice=deleted`);
  } catch (ex) {
    const message = ex instanceof SmartInviteError ? ex.safeMessage : res.locals.t("smartInvites.deleteFailed");
    if (!(ex instanceof SmartInviteError)) req.client.logger.error("dashboard smart invite delete failed", ex);
    res.redirect(`${backTo}?error=${encodeURIComponent(message)}`);
  }
});

module.exports = router;
