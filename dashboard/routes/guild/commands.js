const express = require("express");
const router = express.Router();
const { getSettings } = require("@schemas/Guild");
const { buildCommandCatalog } = require("../../services/commandCatalog");

router.get("/", async (req, res) => {
  const settings = await getSettings(req.guild);
  const catalog = buildCommandCatalog({
    client: req.client,
    guild: req.guild,
    member: req.member,
    isOwner: req.isOwner,
    prefix: settings.prefix || "!",
  });

  res.render("guild/commands", {
    title: `${res.locals.t("commands.title")} — ${req.guild.name}`,
    guild: req.guild,
    prefix: settings.prefix || "!",
    ...catalog,
  });
});

module.exports = router;
