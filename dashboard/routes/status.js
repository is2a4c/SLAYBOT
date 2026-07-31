const express = require("express");
const { buildStatusReport } = require("@src/services/status/StatusReport");

const router = express.Router();

/**
 * Public status page and machine-readable endpoint.
 *
 * No authentication on purpose: the payload carries counts and health only, never
 * guild names, ids or member data, so it can be linked from a support server or
 * polled by an uptime monitor.
 */
function statusPage(req, res) {
  const report = buildStatusReport({ client: req.client });
  res.render("status", { title: res.locals.t("status.title"), report });
}

function statusJson(req, res) {
  const report = buildStatusReport({ client: req.client });
  res.set("cache-control", "no-store");
  res.status(report.status === "outage" ? 503 : 200).json(report);
}

router.get("/", statusPage);
// Kept as a compatibility alias for already published links.
router.get("/status.json", statusJson);

module.exports = router;
module.exports.statusJson = statusJson;
