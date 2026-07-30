const express = require("express");
const router = express.Router();
const { getSettings } = require("@schemas/Guild");
const SmartInvite = require("@schemas/SmartInvite");
const { runDiagnostics } = require("@src/services/dashboard/diagnostics");

router.get("/", async (req, res) => {
  const { guild } = req;
  const [settings, smartInvites] = await Promise.all([
    getSettings(guild),
    SmartInvite.find({ guildId: guild.id, status: "active" }).select("channelId status").lean(),
  ]);

  const result = runDiagnostics(guild, settings, { smartInvites });

  res.render("guild/diagnostics", {
    title: `${res.locals.t("diagnostics.title")} — ${guild.name}`,
    guild,
    result,
  });
});

module.exports = router;
