const express = require("express");
const router = express.Router();
const BlockedServer = require("@schemas/BlockedServer");
const SmartInviteError = require("@src/services/smart-invites/SmartInviteError");
const { SmartInviteService } = require("@src/services/smart-invites/SmartInviteService");
const { removeExpiredBlocks, isValidServerId } = require("@src/services/blockedServers");
const blockServerCommand = require("@src/commands/owner/blockserver");
const leaveServerCommand = require("@src/commands/owner/leaveserver");
const { logAudit } = require("@src/services/dashboard/auditLog");
const { requireOwner } = require("../../auth/middleware");
const { requireCsrf } = require("../../auth/csrf");

const SMART_INVITE_ACTIONS = new Set(["disable", "unlock", "reserve", "block-guild", "unblock-guild"]);

router.use(requireOwner);

function resultRedirect(res, type, message) {
  const params = new URLSearchParams({ [type]: message });
  return res.redirect(`${res.locals.basePath}/owner/operations?${params}`);
}

function actor(req) {
  return {
    actorId: req.session.user.id,
    actorTag: req.session.user.username,
  };
}

function confirmed(req, expected) {
  return String(req.body.confirmation || "").trim() === String(expected || "").trim();
}

router.get("/", async (req, res) => {
  await removeExpiredBlocks();
  const blockedServers = await BlockedServer.find({}).sort({ blockedAt: -1 }).limit(100).lean();
  res.render("owner/operations", {
    title: res.locals.t("ownerOps.title"),
    blockedServers,
    success: typeof req.query.success === "string" ? req.query.success : null,
    error: typeof req.query.error === "string" ? req.query.error : null,
  });
});

router.post("/block-server", requireCsrf, async (req, res) => {
  const serverId = String(req.body.serverId || "").trim();
  if (!isValidServerId(serverId) || !confirmed(req, serverId)) {
    return resultRedirect(res, "error", res.locals.t("ownerOps.invalidConfirmation"));
  }

  const response = await blockServerCommand.executeAction({
    action: "block",
    serverId,
    durationInput: String(req.body.duration || "forever"),
    reason: String(req.body.reason || ""),
    user: req.session.user,
    client: req.client,
  });
  if (typeof response === "string" && response.startsWith("❌")) {
    return resultRedirect(res, "error", response.replace(/^❌\s*/, ""));
  }

  await logAudit({
    ...actor(req),
    action: "owner_server_block",
    guildId: serverId,
    targetType: "guild",
    targetId: serverId,
    after: { duration: String(req.body.duration || "forever") },
    reason: String(req.body.reason || ""),
  });
  return resultRedirect(res, "success", res.locals.t("ownerOps.serverBlocked"));
});

router.post("/unblock-server", requireCsrf, async (req, res) => {
  const serverId = String(req.body.serverId || "").trim();
  if (!isValidServerId(serverId)) return resultRedirect(res, "error", res.locals.t("errors.invalidUserId"));

  const response = await blockServerCommand.executeAction({
    action: "unblock",
    serverId,
    user: req.session.user,
    client: req.client,
  });
  await logAudit({
    ...actor(req),
    action: "owner_server_unblock",
    guildId: serverId,
    targetType: "guild",
    targetId: serverId,
  });
  const message = response.replace(/^✅\s*/u, "").replace(/^ℹ️\s*/u, "");
  return resultRedirect(res, "success", message);
});

router.post("/leave-server", requireCsrf, async (req, res) => {
  const serverId = String(req.body.serverId || "").trim();
  if (!isValidServerId(serverId) || !confirmed(req, serverId)) {
    return resultRedirect(res, "error", res.locals.t("ownerOps.invalidConfirmation"));
  }

  const guild = req.client.guilds.cache.get(serverId);
  if (!guild) return resultRedirect(res, "error", res.locals.t("ownerOps.serverNotFound"));
  const guildName = guild.name;
  const response = await leaveServerCommand.leaveServer(req.client, serverId);
  if (!response.startsWith("Successfully")) return resultRedirect(res, "error", response);

  await logAudit({
    ...actor(req),
    action: "owner_server_leave",
    guildId: serverId,
    targetType: "guild",
    targetId: serverId,
    before: { name: guildName },
  });
  return resultRedirect(res, "success", res.locals.t("ownerOps.serverLeft", { name: guildName }));
});

router.post("/smart-invites", requireCsrf, async (req, res) => {
  const action = String(req.body.action || "");
  const value = String(req.body.value || "").trim();
  if (!SMART_INVITE_ACTIONS.has(action) || !value) {
    return resultRedirect(res, "error", res.locals.t("ownerOps.invalidOperation"));
  }
  if (!confirmed(req, value)) return resultRedirect(res, "error", res.locals.t("ownerOps.invalidConfirmation"));

  const service = req.client.smartInvites || new SmartInviteService(req.client);
  try {
    if (action === "disable") await service.disableLink(value);
    if (action === "unlock") await service.forceUnlock(value);
    if (action === "reserve") await service.reserveSlug(value);
    if (action === "block-guild" || action === "unblock-guild") {
      if (!isValidServerId(value))
        throw new SmartInviteError("INVALID_GUILD", res.locals.t("ownerOps.invalidServerId"));
      await service.setGuildBlocked(value, action === "block-guild");
    }
  } catch (error) {
    const message = error instanceof SmartInviteError ? error.safeMessage : res.locals.t("errors.internalMessage");
    if (!(error instanceof SmartInviteError))
      req.client.logger.error("dashboard owner Smart Invite operation failed", error);
    return resultRedirect(res, "error", message);
  }

  await logAudit({
    ...actor(req),
    action: `owner_smart_invite_${action.replace("-", "_")}`,
    guildId: action.endsWith("guild") ? value : null,
    targetType: action.endsWith("guild") ? "guild" : "smart_invite",
    targetId: value,
  });
  return resultRedirect(res, "success", res.locals.t("ownerOps.smartInviteComplete"));
});

module.exports = router;
module.exports.SMART_INVITE_ACTIONS = SMART_INVITE_ACTIONS;
