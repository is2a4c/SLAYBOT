const express = require("express");
const router = express.Router();
const { getSettings } = require("@schemas/Guild");
const SmartInvite = require("@schemas/SmartInvite");
const { getDashboardTelemetrySummary } = require("@src/services/dashboard/telemetry");

const TICKET_TOPIC_PREFIX = "tіcket|"; // matches src/helpers/TicketPermissions.js getTicketMetadata

router.get("/", async (req, res) => {
  const { guild } = req;
  const client = req.client;
  const settings = await getSettings(guild);

  const [dailySummary, activeSmartInvites] = await Promise.all([
    getDashboardTelemetrySummary(client, { scope: "guild", guildId: guild.id, periodDays: 1 }),
    SmartInvite.countDocuments({ guildId: guild.id, status: { $in: ["active", "degraded"] } }),
  ]);

  const openTickets = guild.channels.cache.filter((c) => c.topic?.startsWith(TICKET_TOPIC_PREFIX)).size;

  const attention = [];
  if (!settings.modlog_channel) attention.push(res.locals.t("overview.attModlogMissing"));
  if (!guild.members.me.permissions.has("ManageMessages")) attention.push(res.locals.t("overview.attManageMessages"));
  if (!guild.members.me.permissions.has("ModerateMembers"))
    attention.push(res.locals.t("overview.attModerateMembers"));
  if (settings.ticket?.log_channel && !guild.channels.cache.has(settings.ticket.log_channel)) {
    attention.push(res.locals.t("overview.attTicketLogMissing"));
  }

  res.render("guild/overview", {
    title: guild.name,
    guild,
    settings,
    counters: {
      members: guild.memberCount,
      messages24h: dailySummary.counters.messages,
      automodActions24h: dailySummary.counters.automod_actions,
      openTickets,
      activeSmartInvites,
      errors24h: dailySummary.counters.client_errors,
    },
    attention,
    error: typeof req.query.error === "string" ? req.query.error : null,
  });
});

module.exports = router;
