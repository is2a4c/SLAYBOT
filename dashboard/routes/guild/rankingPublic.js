const express = require("express");
const router = express.Router({ mergeParams: true });
const { getSettings } = require("@schemas/Guild");
const { getXpLb } = require("@schemas/MemberStats");
const { leaderboardLimit, publicPageEnabled } = require("@src/services/stats/RankingPolicy");

/**
 * A server's leaderboard, readable by anyone with the link - no session, no
 * dashboard access. Only ever shown when the server itself turned this on;
 * everything else about the server stays behind the normal login.
 */

router.get("/", async (req, res) => {
  const guild = req.client.guilds.cache.get(req.params.guildId);
  if (!guild) {
    return res.status(404).render("error", {
      title: res.locals.t("errors.notFoundTitle"),
      message: res.locals.t("errors.notFoundMessage"),
    });
  }

  const settings = await getSettings(guild);
  if (!settings.stats?.enabled || !publicPageEnabled(settings)) {
    return res.status(404).render("error", {
      title: res.locals.t("errors.notFoundTitle"),
      message: res.locals.t("errors.notFoundMessage"),
    });
  }

  const leaderboard = await getXpLb(guild.id, leaderboardLimit(settings, 500));

  res.render("guild/rankingPublic", {
    title: `${res.locals.t("ranking.publicTitle")} — ${guild.name}`,
    guildName: guild.name,
    guildIconURL: guild.iconURL({ size: 128 }) || null,
    leaderboard: leaderboard.map((entry, index) => {
      const member = guild.members.cache.get(entry.member_id);
      return {
        rank: index + 1,
        level: entry.level,
        xp: entry.xp,
        name: member?.displayName || member?.user?.username || entry.member_id,
        avatarURL: member?.displayAvatarURL?.({ size: 64 }) || null,
      };
    }),
  });
});

module.exports = router;
