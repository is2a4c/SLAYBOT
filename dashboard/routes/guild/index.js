const express = require("express");
const router = express.Router({ mergeParams: true });
const { requireGuildAccess } = require("../../auth/middleware");

router.use(requireGuildAccess);

router.use("/", require("./overview"));
router.use("/config", require("./config"));
router.use("/automod", require("./automod"));
router.use("/modlog", require("./modlog"));
router.use("/members", require("./members"));
router.use("/smart-invites", require("./smart-invites"));
router.use("/diagnostics", require("./diagnostics"));
router.use("/audit", require("./audit"));

module.exports = router;
