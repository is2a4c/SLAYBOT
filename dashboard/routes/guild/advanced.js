const express = require("express");
const router = express.Router();
const { getSettings } = require("@schemas/Guild");
const { applyGuildConfigPatch } = require("@src/services/dashboard/guildConfig");
const { buildAdvancedPatch, fieldsForView } = require("../../services/advancedSettings");
const { requireCsrf } = require("../../auth/csrf");

function availableOptions(guild) {
  const channels = [...guild.channels.cache.values()];
  return {
    text: channels.filter((entry) => entry.isTextBased?.() && !entry.isThread?.()),
    voice: channels.filter((entry) => entry.type === 2),
    category: channels.filter((entry) => entry.type === 4),
    roles: [...guild.roles.cache.filter((entry) => entry.id !== guild.id && !entry.managed).values()],
  };
}

router.get("/", async (req, res) => {
  const settings = await getSettings(req.guild);
  res.render("guild/advanced", {
    title: `${res.locals.t("advanced.title")} — ${req.guild.name}`,
    guild: req.guild,
    sections: fieldsForView(settings),
    options: availableOptions(req.guild),
  });
});

router.post("/", requireCsrf, async (req, res) => {
  const settings = await getSettings(req.guild);
  await applyGuildConfigPatch(req.guild, buildAdvancedPatch(req.guild, req.body, settings), {
    id: req.session.user.id,
    tag: req.session.user.username,
    action: "advanced_config_update",
    reason: "Dashboard: advanced guild configuration",
  });
  res.redirect(`${res.locals.basePath}/g/${req.guild.id}/advanced?notice=saved`);
});

module.exports = router;
