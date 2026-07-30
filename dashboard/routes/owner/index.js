const express = require("express");
const router = express.Router();
const { getSettings } = require("@schemas/Guild");
const { requirePermission } = require("../../auth/middleware");

router.get("/", requirePermission("guilds.view"), async (req, res) => {
  const client = req.client;
  const periodDays = [1, 7, 30].includes(Number(req.query.period)) ? Number(req.query.period) : 1;

  const globalSummary = await client.telemetry.getSummary({ scope: "global", periodDays });

  const guilds = await Promise.all(
    [...client.guilds.cache.values()].map(async (guild) => {
      const settings = await getSettings(guild).catch(() => null);
      return {
        id: guild.id,
        name: guild.name,
        memberCount: guild.memberCount,
        ownerId: settings?.data?.owner || guild.ownerId,
        joinedAt: settings?.data?.joinedAt || guild.joinedAt,
        modlogConfigured: Boolean(settings?.modlog_channel),
      };
    })
  );
  guilds.sort((a, b) => b.memberCount - a.memberCount);

  res.render("owner/index", {
    title: res.locals.t("owner.title"),
    periodDays,
    summary: globalSummary,
    guildCount: client.guilds.cache.size,
    guilds,
  });
});

router.use("/staff", require("./staff"));
router.use("/audit", require("./audit"));

module.exports = router;
