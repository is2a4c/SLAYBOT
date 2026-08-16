const express = require("express");
const router = express.Router();
const { getSettings } = require("@schemas/Guild");
const { applyGuildConfigPatch } = require("@src/services/dashboard/guildConfig");
const { listEventLogs } = require("@schemas/EventLog");
const { EVENT_TYPES } = require("@src/services/eventRouter/catalog");
const { buildIgnoredChannels, buildRoutes, routesForView } = require("../../services/eventRouterSettings");
const { requireCsrf } = require("../../auth/csrf");

const PAGE_SIZE = 25;

function options(guild) {
  return {
    channels: [...guild.channels.cache.filter((entry) => entry.isTextBased?.() && !entry.isThread?.()).values()],
    roles: [...guild.roles.cache.filter((entry) => entry.id !== guild.id && !entry.managed).values()],
    allChannels: [...guild.channels.cache.filter((entry) => !entry.isThread?.()).values()],
  };
}

const SNOWFLAKE = /^\d{17,20}$/;

router.get("/", async (req, res) => {
  const settings = await getSettings(req.guild);
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const type = EVENT_TYPES.includes(req.query.type) ? req.query.type : null;
  const memberId = SNOWFLAKE.test(req.query.memberId || "") ? req.query.memberId : null;
  const channelId = req.guild.channels.cache.has(req.query.channelId) ? req.query.channelId : null;

  const [entries, total] = await listEventLogs({
    guildId: req.guild.id,
    type,
    memberId,
    channelId,
    page,
    pageSize: PAGE_SIZE,
  });

  res.render("guild/event-router", {
    title: `${res.locals.t("eventRouter.title")} — ${req.guild.name}`,
    guild: req.guild,
    routes: routesForView(settings),
    options: options(req.guild),
    ignoredChannels: settings.event_router_ignored_channels || [],
    entries,
    page,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    filterType: type,
    filterMemberId: memberId,
    filterChannelId: channelId,
    eventTypes: EVENT_TYPES,
  });
});

router.post("/", requireCsrf, async (req, res) => {
  const routes = buildRoutes(req.guild, req.body);
  const ignoredChannels = buildIgnoredChannels(req.guild, req.body.ignored_channels);

  await applyGuildConfigPatch(
    req.guild,
    { event_router: routes, event_router_ignored_channels: ignoredChannels },
    {
      id: req.session.user.id,
      tag: req.session.user.username,
      action: "event_router_update",
      reason: "Dashboard: event router configuration",
    }
  );

  return res.redirect(`${res.locals.basePath}/g/${req.guild.id}/event-router?notice=saved`);
});

module.exports = router;
