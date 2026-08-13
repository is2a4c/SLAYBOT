const express = require("express");
const router = express.Router();
const { getSettings } = require("@schemas/Guild");
const { applyGuildConfigPatch } = require("@src/services/dashboard/guildConfig");
const { requireCsrf } = require("../../auth/csrf");
const { CONTROL_MODULES, buildControlPatch, findModule, moduleForView } = require("../../services/controlCenter");

function availableOptions(guild) {
  const channels = [...guild.channels.cache.values()];
  return {
    text: channels.filter((entry) => entry.isTextBased?.() && !entry.isThread?.()),
    voice: channels.filter((entry) => entry.type === 2),
    category: channels.filter((entry) => entry.type === 4),
    roles: [...guild.roles.cache.filter((entry) => entry.id !== guild.id && !entry.managed).values()],
  };
}

router.get("/:module?", async (req, res) => {
  const selected = findModule(req.params.module || "common");
  if (!selected) return res.redirect(`${res.locals.basePath}/g/${req.guild.id}/control/common`);

  const settings = await getSettings(req.guild);
  return res.render("guild/control", {
    title: `${res.locals.t("control.title")} — ${req.guild.name}`,
    guild: req.guild,
    modules: CONTROL_MODULES,
    selected: moduleForView(selected, settings),
    options: availableOptions(req.guild),
  });
});

router.post("/:module", requireCsrf, async (req, res) => {
  const selected = findModule(req.params.module);
  if (!selected)
    return res.status(404).render("error", {
      title: res.locals.t("errors.notFoundTitle"),
      message: res.locals.t("errors.notFoundMessage"),
    });

  const settings = await getSettings(req.guild);
  const patch = buildControlPatch(req.guild, req.body, settings, selected);
  await applyGuildConfigPatch(req.guild, patch, {
    id: req.session.user.id,
    tag: req.session.user.username,
    action: `control_center_${selected.id}_update`,
    reason: `Dashboard: ${selected.id} control center update`,
  });

  return res.redirect(`${res.locals.basePath}/g/${req.guild.id}/control/${selected.id}?notice=saved`);
});

module.exports = router;
