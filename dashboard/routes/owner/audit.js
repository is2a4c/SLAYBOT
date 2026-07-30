const express = require("express");
const router = express.Router();
const { listAuditLog } = require("@src/services/dashboard/auditLog");
const { requirePermission } = require("../../auth/middleware");

router.get("/", requirePermission("audit.view"), async (req, res) => {
  const entries = await listAuditLog({ limit: 300 });
  res.render("owner/audit", { title: res.locals.t("audit.globalTitle"), entries });
});

module.exports = router;
