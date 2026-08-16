const express = require("express");
const router = express.Router();
const { logAudit } = require("@src/services/dashboard/auditLog");
const { requireCsrf } = require("../../auth/csrf");
const {
  DashboardReminderError,
  createDashboardReminder,
  deleteGuildReminder,
  listGuildReminders,
  previewDashboardReminder,
} = require("../../services/dashboardReminders");

const SNOWFLAKE = /^\d{17,20}$/;
const backTo = (res, guildId) => `${res.locals.basePath}/g/${guildId}/reminders`;

function options(guild) {
  return {
    channels: [...guild.channels.cache.filter((entry) => entry.isTextBased?.() && !entry.isThread?.()).values()],
    roles: [...guild.roles.cache.filter((entry) => entry.id !== guild.id && !entry.managed).values()],
  };
}

async function renderReminders(req, res, extra = {}) {
  const channelId = SNOWFLAKE.test(req.query.channelId || "") ? req.query.channelId : null;
  const creatorId = SNOWFLAKE.test(req.query.creatorId || "") ? req.query.creatorId : null;
  const q =
    String(req.query.q || "")
      .trim()
      .slice(0, 200) || null;
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);

  const { reminders, pages } = await listGuildReminders(req.guild.id, { channelId, creatorId, q, page });
  const guildOptions = options(req.guild);

  res.render("guild/reminders", {
    title: `${res.locals.t("reminders.title")} — ${req.guild.name}`,
    guild: req.guild,
    reminders,
    channels: guildOptions.channels,
    roles: guildOptions.roles,
    page,
    totalPages: pages,
    filterChannelId: channelId,
    filterCreatorId: creatorId,
    filterQuery: q,
    preview: null,
    error: typeof req.query.error === "string" ? req.query.error : null,
    ...extra,
  });
}

router.get("/", async (req, res) => renderReminders(req, res));

router.post("/", requireCsrf, async (req, res) => {
  const redirect = backTo(res, req.guild.id);

  if (req.body.intent === "preview") {
    try {
      const preview = previewDashboardReminder(req.guild, req.session.user.id, req.body);
      return renderReminders(req, res, { preview });
    } catch (error) {
      if (!(error instanceof DashboardReminderError))
        req.client.logger.error("dashboard reminder preview failed", error);
      const message = error instanceof DashboardReminderError ? error.message : res.locals.t("errors.internalMessage");
      return renderReminders(req, res, { error: message });
    }
  }

  try {
    const created = await createDashboardReminder(req.guild, req.session.user.id, req.body);
    await logAudit({
      actorId: req.session.user.id,
      actorTag: req.session.user.username,
      action: "reminder_create",
      guildId: req.guild.id,
      targetType: "scheduled_task",
      targetId: created.remindAt.toISOString(),
      after: { channelId: req.body.channelId, repeatMinutes: req.body.repeatMinutes || null },
    });
    return res.redirect(`${redirect}?notice=created`);
  } catch (error) {
    if (!(error instanceof DashboardReminderError)) req.client.logger.error("dashboard reminder create failed", error);
    const message = error instanceof DashboardReminderError ? error.message : res.locals.t("errors.internalMessage");
    return res.redirect(`${redirect}?error=${encodeURIComponent(message)}`);
  }
});

router.post("/:id/delete", requireCsrf, async (req, res) => {
  const redirect = backTo(res, req.guild.id);
  try {
    await deleteGuildReminder(req.guild.id, req.params.id);
    await logAudit({
      actorId: req.session.user.id,
      actorTag: req.session.user.username,
      action: "reminder_delete",
      guildId: req.guild.id,
      targetType: "scheduled_task",
      targetId: req.params.id,
    });
    return res.redirect(`${redirect}?notice=deleted`);
  } catch (error) {
    const message = error instanceof DashboardReminderError ? error.message : res.locals.t("errors.internalMessage");
    return res.redirect(`${redirect}?error=${encodeURIComponent(message)}`);
  }
});

module.exports = router;
