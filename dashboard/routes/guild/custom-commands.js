const express = require("express");
const router = express.Router();
const { logAudit } = require("@src/services/dashboard/auditLog");
const { requireCsrf } = require("../../auth/csrf");
const {
  CustomCommandError,
  addAction,
  createCommand,
  deleteAction,
  deleteCommand,
  findCommand,
  listCommands,
  updateCommand,
} = require("../../services/customCommands");

const root = (res, guildId) => `${res.locals.basePath}/g/${guildId}/custom-commands`;
const options = (guild) => ({
  channels: [...guild.channels.cache.filter((entry) => entry.isTextBased?.() && !entry.isThread?.()).values()],
  roles: [...guild.roles.cache.filter((entry) => entry.id !== guild.id && !entry.managed).values()],
});

router.get("/", async (req, res) => {
  const commands = await listCommands(req.guild.id);
  res.render("guild/custom-commands", {
    title: `${res.locals.t("customCommands.title")} — ${req.guild.name}`,
    guild: req.guild,
    commands,
    error: typeof req.query.error === "string" ? req.query.error : null,
  });
});

router.post("/", requireCsrf, async (req, res) => {
  const redirect = root(res, req.guild.id);
  try {
    const command = await createCommand(req.guild, req.body, req.session.user.id, req.client);
    await logAudit({
      actorId: req.session.user.id,
      actorTag: req.session.user.username,
      action: "custom_command_create",
      guildId: req.guild.id,
      targetType: "custom_command",
      targetId: String(command._id),
      after: { name: command.name },
    });
    return res.redirect(`${redirect}/${command._id}?notice=created`);
  } catch (error) {
    const message = error instanceof CustomCommandError ? error.message : res.locals.t("errors.internalMessage");
    return res.redirect(`${redirect}?error=${encodeURIComponent(message)}`);
  }
});

router.get("/:id", async (req, res) => {
  try {
    const command = await findCommand(req.guild.id, req.params.id);
    return res.render("guild/custom-command-edit", {
      title: `${command.name} — ${req.guild.name}`,
      guild: req.guild,
      command,
      options: options(req.guild),
      error: typeof req.query.error === "string" ? req.query.error : null,
    });
  } catch (error) {
    return res.redirect(`${root(res, req.guild.id)}?error=${encodeURIComponent(error.message)}`);
  }
});

router.post("/:id", requireCsrf, async (req, res) => {
  const redirect = `${root(res, req.guild.id)}/${req.params.id}`;
  try {
    const command = await updateCommand(req.guild, req.params.id, req.body, req.client);
    await logAudit({
      actorId: req.session.user.id,
      actorTag: req.session.user.username,
      action: "custom_command_update",
      guildId: req.guild.id,
      targetType: "custom_command",
      targetId: req.params.id,
      after: { name: command.name, enabled: command.enabled },
    });
    return res.redirect(`${redirect}?notice=saved`);
  } catch (error) {
    const message = error instanceof CustomCommandError ? error.message : res.locals.t("errors.internalMessage");
    return res.redirect(`${redirect}?error=${encodeURIComponent(message)}`);
  }
});

router.post("/:id/actions", requireCsrf, async (req, res) => {
  const redirect = `${root(res, req.guild.id)}/${req.params.id}`;
  try {
    await addAction(req.guild, req.params.id, req.body);
    await logAudit({
      actorId: req.session.user.id,
      actorTag: req.session.user.username,
      action: "custom_command_action_create",
      guildId: req.guild.id,
      targetType: "custom_command",
      targetId: req.params.id,
      after: { type: req.body.type },
    });
    return res.redirect(`${redirect}?notice=created`);
  } catch (error) {
    const message = error instanceof CustomCommandError ? error.message : res.locals.t("errors.internalMessage");
    return res.redirect(`${redirect}?error=${encodeURIComponent(message)}`);
  }
});

router.post("/:id/actions/:actionId/delete", requireCsrf, async (req, res) => {
  const redirect = `${root(res, req.guild.id)}/${req.params.id}`;
  try {
    await deleteAction(req.guild.id, req.params.id, req.params.actionId);
    await logAudit({
      actorId: req.session.user.id,
      actorTag: req.session.user.username,
      action: "custom_command_action_delete",
      guildId: req.guild.id,
      targetType: "custom_command",
      targetId: req.params.id,
      after: { actionId: req.params.actionId },
    });
    return res.redirect(`${redirect}?notice=deleted`);
  } catch (error) {
    const message = error instanceof CustomCommandError ? error.message : res.locals.t("errors.internalMessage");
    return res.redirect(`${redirect}?error=${encodeURIComponent(message)}`);
  }
});

router.post("/:id/delete", requireCsrf, async (req, res) => {
  const redirect = root(res, req.guild.id);
  try {
    await deleteCommand(req.guild.id, req.params.id);
    await logAudit({
      actorId: req.session.user.id,
      actorTag: req.session.user.username,
      action: "custom_command_delete",
      guildId: req.guild.id,
      targetType: "custom_command",
      targetId: req.params.id,
    });
    return res.redirect(`${redirect}?notice=deleted`);
  } catch (error) {
    const message = error instanceof CustomCommandError ? error.message : res.locals.t("errors.internalMessage");
    return res.redirect(`${redirect}?error=${encodeURIComponent(message)}`);
  }
});

module.exports = router;
