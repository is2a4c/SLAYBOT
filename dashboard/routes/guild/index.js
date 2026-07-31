const express = require("express");
const router = express.Router({ mergeParams: true });
const { requireGuildAccess, requireGuildPermission } = require("../../auth/middleware");

router.use(requireGuildAccess);

router.use("/config", requireGuildPermission("config.edit"), require("./config"));
router.use("/automod", requireGuildPermission("automod.edit"), require("./automod"));
router.use("/modlog", requireGuildPermission("audit.view"), require("./modlog"));
router.use("/members", requireGuildPermission("members.moderate"), require("./members"));
router.use("/smart-invites", requireGuildPermission("smartinvites.manage"), require("./smart-invites"));
router.use("/diagnostics", requireGuildPermission("diagnostics.run"), require("./diagnostics"));
router.use("/audit", requireGuildPermission("audit.view"), require("./audit"));
router.use("/", requireGuildPermission("guilds.view"), require("./overview"));

module.exports = router;
