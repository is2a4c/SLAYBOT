const express = require("express");
const router = express.Router();
const { auditCsv, listAuditLog } = require("@src/services/dashboard/auditLog");
const { requireGuildPermission } = require("../../auth/middleware");

function filters(query) {
  return {
    action: typeof query.action === "string" ? query.action : "",
    actorId: typeof query.actorId === "string" ? query.actorId : "",
    targetType: typeof query.targetType === "string" ? query.targetType : "",
    search: typeof query.search === "string" ? query.search : "",
  };
}

router.get("/", async (req, res) => {
  const { guild } = req;
  const selected = filters(req.query);
  const entries = await listAuditLog({ guildId: guild.id, ...selected, limit: 200 });
  res.render("guild/audit", { title: `Audit Log — ${guild.name}`, guild, entries, filters: selected });
});

router.get("/export.csv", requireGuildPermission("audit.export"), async (req, res) => {
  const selected = filters(req.query);
  const entries = await listAuditLog({ guildId: req.guild.id, ...selected, limit: 500 });
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="slaybot-audit-${req.guild.id}.csv"`);
  res.send(`\uFEFF${auditCsv(entries)}`);
});

module.exports = router;
module.exports.filters = filters;
