const express = require("express");
const router = express.Router();
const { listStaffAccounts, upsertStaffAccount, removeStaffAccount, STAFF_ROLES } = require("@schemas/StaffAccount");
const { logAudit } = require("@src/services/dashboard/auditLog");
const { requirePermission } = require("../../auth/middleware");
const { requireCsrf } = require("../../auth/csrf");

const SNOWFLAKE = /^\d{17,20}$/;

router.get("/", requirePermission("staff.manage"), async (req, res) => {
  const accounts = await listStaffAccounts();
  res.render("owner/staff", {
    title: "Staff-роли",
    accounts,
    roles: STAFF_ROLES,
    error: typeof req.query.error === "string" ? req.query.error : null,
  });
});

router.post("/", requireCsrf, requirePermission("staff.manage"), async (req, res) => {
  const discordId = String(req.body.discordId || "").trim();
  const role = String(req.body.role || "");

  if (!SNOWFLAKE.test(discordId) || !STAFF_ROLES.includes(role)) {
    return res.redirect(
      `${res.locals.basePath}/owner/staff?error=${encodeURIComponent("Укажите корректный Discord ID и роль.")}`
    );
  }

  await upsertStaffAccount(discordId, role, req.session.user.id);
  await logAudit({
    actorId: req.session.user.id,
    actorTag: req.session.user.username,
    action: "staff_account_upsert",
    targetType: "staff_account",
    targetId: discordId,
    after: { role },
  });

  res.redirect(`${res.locals.basePath}/owner/staff`);
});

router.post("/:discordId/remove", requireCsrf, requirePermission("staff.manage"), async (req, res) => {
  await removeStaffAccount(req.params.discordId);
  await logAudit({
    actorId: req.session.user.id,
    actorTag: req.session.user.username,
    action: "staff_account_remove",
    targetType: "staff_account",
    targetId: req.params.discordId,
  });
  res.redirect(`${res.locals.basePath}/owner/staff`);
});

module.exports = router;
