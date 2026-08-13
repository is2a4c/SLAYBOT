const express = require("express");
const router = express.Router();
const { logAudit } = require("@src/services/dashboard/auditLog");
const { requireCsrf } = require("../../auth/csrf");
const {
  DashboardReminderError,
  createDashboardReminder,
  deleteGuildReminder,
  listGuildReminders,
} = require("../../services/dashboardReminders");

const backTo = (res, guildId) => `${res.locals.basePath}/g/${guildId}/reminders`;

router.get("/", async (req, res) => {
  const reminders = await listGuildReminders(req.guild.id);
  res.render("guild/reminders", {
    title: `${res.locals.t("reminders.title")} — ${req.guild.name}`,
    guild: req.guild,
    reminders,
    channels: [...req.guild.channels.cache.filter((entry) => entry.isTextBased?.() && !entry.isThread?.()).values()],
    roles: [...req.guild.roles.cache.filter((entry) => entry.id !== req.guild.id && !entry.managed).values()],
    error: typeof req.query.error === "string" ? req.query.error : null,
  });
});

router.post("/", requireCsrf, async (req, res) => {
  const redirect = backTo(res, req.guild.id);
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
