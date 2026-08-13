const express = require("express");
const router = express.Router();
const { getSettings } = require("@schemas/Guild");
const { applyGuildConfigPatch } = require("@src/services/dashboard/guildConfig");
const publish = require("@src/services/panels/publish");
const { guildTranslator } = require("@src/i18n");
const { buildAdvancedPatch, fieldsForView, shouldRepublishTicketPanel } = require("../../services/advancedSettings");
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
  const patch = buildAdvancedPatch(req.guild, req.body, settings);
  const previousPanel = {
    channelId: settings.ticket?.panel_channel_id || null,
    messageId: settings.ticket?.panel_message_id || null,
  };
  const republishTicketPanel = shouldRepublishTicketPanel(settings, patch);
  const updated = await applyGuildConfigPatch(req.guild, patch, {
    id: req.session.user.id,
    tag: req.session.user.username,
    action: "advanced_config_update",
    reason: "Dashboard: advanced guild configuration",
  });

  if (republishTicketPanel) {
    if (updated.ticket.panel_channel_id) {
      await publish.ticketPanel(
        { guild: req.guild, client: req.client },
        updated,
        guildTranslator(updated, req.guild),
        previousPanel.channelId
      );
    } else {
      await publish.removePrevious(req.guild, previousPanel.channelId, previousPanel.messageId);
      updated.ticket.panel_message_id = null;
      await updated.save();
    }
  }

  res.redirect(`${res.locals.basePath}/g/${req.guild.id}/advanced?notice=saved`);
});

module.exports = router;
