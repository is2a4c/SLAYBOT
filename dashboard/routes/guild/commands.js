const express = require("express");
const router = express.Router();
const { getSettings } = require("@schemas/Guild");
const { applyGuildConfigPatch } = require("@src/services/dashboard/guildConfig");
const {
  sanitizeCommandPolicy,
  sanitizeDisabledCategories,
  upsertCommandPolicy,
} = require("@src/services/commands/policy");
const { requireCsrf } = require("../../auth/csrf");
const { requireGuildPermission } = require("../../auth/middleware");
const { buildCommandCatalog } = require("../../services/commandCatalog");

/**
 * The roles and channels a policy may name.
 *
 * Everything the form sends is checked against the live guild cache, so a
 * hand-made request cannot store an id from another server — or one that is not
 * a role or a text channel at all.
 *
 * @param {import('discord.js').Guild} guild
 */
function policyTargets(guild) {
  const channels = [...guild.channels.cache.values()];
  return {
    roles: [...guild.roles.cache.filter((entry) => entry.id !== guild.id && !entry.managed).values()],
    channels: channels.filter((entry) => entry.isTextBased?.() && !entry.isThread?.()),
    categories: channels.filter((entry) => entry.type === 4),
  };
}

function catalogFor(req, settings) {
  return buildCommandCatalog({
    client: req.client,
    guild: req.guild,
    member: req.member,
    isOwner: req.isOwner,
    prefix: settings.prefix || "!",
    settings,
  });
}

router.get("/", async (req, res) => {
  const settings = await getSettings(req.guild);
  const catalog = catalogFor(req, settings);
  const targets = policyTargets(req.guild);

  res.render("guild/commands", {
    title: `${res.locals.t("commands.title")} — ${req.guild.name}`,
    guild: req.guild,
    prefix: settings.prefix || "!",
    canEditPolicy: Boolean(res.locals.canGuild("config.edit")),
    roles: targets.roles,
    policyChannels: [...targets.channels, ...targets.categories],
    ...catalog,
  });
});

router.post("/categories", requireGuildPermission("config.edit"), requireCsrf, async (req, res) => {
  const settings = await getSettings(req.guild);
  const known = catalogFor(req, settings).categories.map((entry) => entry.id);
  const disabled = sanitizeDisabledCategories(req.body.disabled || [], known);

  await applyGuildConfigPatch(
    req.guild,
    { "command_policy.disabled_categories": disabled },
    {
      id: req.session.user.id,
      tag: req.session.user.username,
      action: "command_policy_categories_update",
      reason: "Dashboard: command category availability",
    }
  );

  return res.redirect(`${res.locals.basePath}/g/${req.guild.id}/commands?notice=saved`);
});

router.post("/policy", requireGuildPermission("config.edit"), requireCsrf, async (req, res) => {
  const settings = await getSettings(req.guild);
  const catalog = catalogFor(req, settings);
  const targets = policyTargets(req.guild);

  const roleIds = new Set(targets.roles.map((entry) => entry.id));
  const channelIds = new Set([...targets.channels, ...targets.categories].map((entry) => entry.id));

  const next = sanitizeCommandPolicy(
    {
      name: req.body.name,
      enabled: req.body.enabled === "on",
      cooldown_seconds: req.body.cooldown,
      allowed_roles: req.body.roles || [],
      allowed_channels: req.body.channels || [],
    },
    { roleExists: (id) => roleIds.has(id), channelExists: (id) => channelIds.has(id) }
  );

  // A policy for something the bot does not have would sit in the document
  // forever, unreadable and unreachable from the page that wrote it.
  if (!next || !catalog.commands.some((command) => command.name === next.name)) {
    return res.status(400).render("error", {
      title: res.locals.t("errors.badRequestTitle"),
      message: res.locals.t("commands.policyUnknownCommand"),
    });
  }

  await applyGuildConfigPatch(
    req.guild,
    { "command_policy.commands": upsertCommandPolicy(settings.command_policy?.commands, next) },
    {
      id: req.session.user.id,
      tag: req.session.user.username,
      action: "command_policy_update",
      reason: `Dashboard: command policy for ${next.name}`,
    }
  );

  return res.redirect(`${res.locals.basePath}/g/${req.guild.id}/commands?notice=saved#command-${next.name}`);
});

module.exports = router;
