const express = require("express");
const router = express.Router({ mergeParams: true });
const { requireGuildAccess, requireGuildPermission } = require("../../auth/middleware");

router.use(requireGuildAccess);

router.use("/config", requireGuildPermission("config.edit"), require("./config"));
router.use("/control", requireGuildPermission("config.edit"), require("./control"));
router.use("/advanced", requireGuildPermission("config.edit"), require("./advanced"));
router.use("/subscriptions", requireGuildPermission("config.edit"), require("./subscriptions"));
router.use("/reminders", requireGuildPermission("config.edit"), require("./reminders"));
router.use("/ranking", requireGuildPermission("config.edit"), require("./ranking"));
router.use("/automod", requireGuildPermission("automod.edit"), require("./automod"));
router.use("/commands", requireGuildPermission("guilds.view"), require("./commands"));
router.use("/modlog", requireGuildPermission("audit.view"), require("./modlog"));
router.use("/members", requireGuildPermission("members.moderate"), require("./members"));
router.use("/smart-invites", requireGuildPermission("smartinvites.manage"), require("./smart-invites"));
router.use("/diagnostics", requireGuildPermission("diagnostics.run"), require("./diagnostics"));
router.use("/audit", requireGuildPermission("audit.view"), require("./audit"));
router.use("/", requireGuildPermission("guilds.view"), require("./overview"));

module.exports = router;
