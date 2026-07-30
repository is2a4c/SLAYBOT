const express = require("express");
const router = express.Router();
const { listAuditLog } = require("@src/services/dashboard/auditLog");

router.get("/", async (req, res) => {
  const { guild } = req;
  const entries = await listAuditLog({ guildId: guild.id, limit: 200 });
  res.render("guild/audit", { title: `Audit Log — ${guild.name}`, guild, entries });
});

module.exports = router;
