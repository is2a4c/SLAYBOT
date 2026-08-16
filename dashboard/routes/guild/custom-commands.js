const express = require("express");
const router = express.Router();
const { logAudit } = require("@src/services/dashboard/auditLog");
const { requireCsrf } = require("../../auth/csrf");
const {
  CustomCommandError,
  addAction,
  addOption,
  addSubcommand,
  createCommand,
  deleteAction,
  deleteCommand,
  deleteOption,
  deleteSubcommand,
  findCommand,
  listCommands,
  publishCommands,
  updateCommand,
} = require("../../services/customCommands");
const { MAX_ACTIONS, MAX_CUSTOM_COMMANDS, MAX_MODAL_INPUTS, OPTION_TYPES } = require("@schemas/CustomCommand");

const root = (res, guildId) => `${res.locals.basePath}/g/${guildId}/custom-commands`;
const options = (guild) => ({
  channels: [...guild.channels.cache.filter((entry) => entry.isTextBased?.() && !entry.isThread?.()).values()],
  roles: [...guild.roles.cache.filter((entry) => entry.id !== guild.id && !entry.managed).values()],
});

/**
 * Commands as the list page shows them: ungrouped while nobody has bothered
 * naming a second group, so the common case stays exactly as plain as it was
 * before "group" existed.
 *
 * @param {object[]} commands
 * @returns {{group: string|null, commands: object[]}[]}
 */
function groupCommands(commands) {
  const byGroup = new Map();
  for (const command of commands) {
    const key = command.group || "CUSTOM";
    if (!byGroup.has(key)) byGroup.set(key, []);
    byGroup.get(key).push(command);
  }
  const entries = [...byGroup.entries()].sort(([a], [b]) => a.localeCompare(b));
  // A header above a single, unnamed group would just repeat "CUSTOM" for
  // every server that never touched grouping at all.
  if (entries.length <= 1) return [{ group: null, commands }];
  return entries.map(([group, list]) => ({ group, commands: list }));
}

/**
 * Republish this guild's commands and say in the audit log what Discord did
 * with them, so a name Discord refused is visible rather than silently absent.
 *
 * @param {import('express').Request} req
 * @param {string} action audit action name
 * @param {string} targetId
 * @param {object} after what changed
 */
async function saveAndPublish(req, { action, targetId, after }) {
  const sync = await publishCommands(req.guild, req.client.logger).catch((error) => {
    req.client.logger.error("custom commands: publication failed", error);
    return { created: [], updated: [], removed: [], conflicts: [], failed: ["publish"] };
  });

  await logAudit({
    actorId: req.session.user.id,
    actorTag: req.session.user.username,
    action,
    guildId: req.guild.id,
    targetType: "custom_command",
    targetId,
    after: { ...after, published: sync },
  });

  return sync;
}

/**
 * A name Discord refused, or one already taken, is worth saying on the page —
 * the save itself succeeded, but the command will not appear in Discord.
 *
 * @param {object} sync
 * @returns {string}
 */
function publishNotice(sync) {
  if (sync.conflicts.length) return `&error=${encodeURIComponent(`Name already in use: ${sync.conflicts.join(", ")}`)}`;
  if (sync.failed.length) return `&error=${encodeURIComponent(`Discord refused: ${sync.failed.join(", ")}`)}`;
  return "";
}

router.get("/", async (req, res) => {
  const commands = await listCommands(req.guild.id);
  res.render("guild/custom-commands", {
    title: `${res.locals.t("customCommands.title")} — ${req.guild.name}`,
    guild: req.guild,
    commands,
    groups: groupCommands(commands),
    maxCustomCommands: MAX_CUSTOM_COMMANDS,
    error: typeof req.query.error === "string" ? req.query.error : null,
  });
});

router.post("/", requireCsrf, async (req, res) => {
  const redirect = root(res, req.guild.id);
  try {
    const command = await createCommand(req.guild, req.body, req.client);
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
      optionTypes: OPTION_TYPES,
      maxModalInputs: MAX_MODAL_INPUTS,
      maxActions: MAX_ACTIONS,
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
    const sync = await saveAndPublish(req, {
      action: "custom_command_update",
      targetId: req.params.id,
      after: {
        name: command.name,
        enabled: command.enabled,
        triggers: command.triggers.toObject?.() ?? command.triggers,
      },
    });
    return res.redirect(`${redirect}?notice=saved${publishNotice(sync)}`);
  } catch (error) {
    const message = error instanceof CustomCommandError ? error.message : res.locals.t("errors.internalMessage");
    return res.redirect(`${redirect}?error=${encodeURIComponent(message)}`);
  }
});

router.post("/:id/options", requireCsrf, async (req, res) => {
  const redirect = `${root(res, req.guild.id)}/${req.params.id}`;
  try {
    await addOption(req.guild.id, req.params.id, req.body);
    const sync = await saveAndPublish(req, {
      action: "custom_command_option_create",
      targetId: req.params.id,
      after: { option: req.body.optionName, subcommand: req.body.subcommand || null },
    });
    return res.redirect(`${redirect}?notice=created${publishNotice(sync)}`);
  } catch (error) {
    const message = error instanceof CustomCommandError ? error.message : res.locals.t("errors.internalMessage");
    return res.redirect(`${redirect}?error=${encodeURIComponent(message)}`);
  }
});

router.post("/:id/options/delete", requireCsrf, async (req, res) => {
  const redirect = `${root(res, req.guild.id)}/${req.params.id}`;
  try {
    await deleteOption(req.guild.id, req.params.id, req.body.optionName, req.body.subcommand);
    const sync = await saveAndPublish(req, {
      action: "custom_command_option_delete",
      targetId: req.params.id,
      after: { option: req.body.optionName, subcommand: req.body.subcommand || null },
    });
    return res.redirect(`${redirect}?notice=deleted${publishNotice(sync)}`);
  } catch (error) {
    const message = error instanceof CustomCommandError ? error.message : res.locals.t("errors.internalMessage");
    return res.redirect(`${redirect}?error=${encodeURIComponent(message)}`);
  }
});

router.post("/:id/subcommands", requireCsrf, async (req, res) => {
  const redirect = `${root(res, req.guild.id)}/${req.params.id}`;
  try {
    await addSubcommand(req.guild.id, req.params.id, req.body);
    const sync = await saveAndPublish(req, {
      action: "custom_command_subcommand_create",
      targetId: req.params.id,
      after: { subcommand: req.body.subcommandName },
    });
    return res.redirect(`${redirect}?notice=created${publishNotice(sync)}`);
  } catch (error) {
    const message = error instanceof CustomCommandError ? error.message : res.locals.t("errors.internalMessage");
    return res.redirect(`${redirect}?error=${encodeURIComponent(message)}`);
  }
});

router.post("/:id/subcommands/delete", requireCsrf, async (req, res) => {
  const redirect = `${root(res, req.guild.id)}/${req.params.id}`;
  try {
    await deleteSubcommand(req.guild.id, req.params.id, req.body.subcommandName);
    const sync = await saveAndPublish(req, {
      action: "custom_command_subcommand_delete",
      targetId: req.params.id,
      after: { subcommand: req.body.subcommandName },
    });
    return res.redirect(`${redirect}?notice=deleted${publishNotice(sync)}`);
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
    const command = await deleteCommand(req.guild, req.params.id, req.client.logger);
    await logAudit({
      actorId: req.session.user.id,
      actorTag: req.session.user.username,
      action: "custom_command_delete",
      guildId: req.guild.id,
      targetType: "custom_command",
      targetId: req.params.id,
      before: { name: command.name, registrations: command.registrations?.length || 0 },
    });
    return res.redirect(`${redirect}?notice=deleted`);
  } catch (error) {
    const message = error instanceof CustomCommandError ? error.message : res.locals.t("errors.internalMessage");
    return res.redirect(`${redirect}?error=${encodeURIComponent(message)}`);
  }
});

module.exports = router;
