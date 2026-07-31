const express = require("express");
const router = express.Router();
const { PermissionsBitField } = require("discord.js");
const { requireAuth } = require("../auth/middleware");

router.get("/", requireAuth, (req, res) => {
  const client = req.client;
  const canViewAllGuilds = req.dashboardPermissions?.has("guilds.view");

  const guildsById = new Map(
    (req.session.user.guilds || [])
      .map((g) => {
        let manageable = g.owner;
        if (!manageable && g.permissions) {
          try {
            manageable = new PermissionsBitField(BigInt(g.permissions)).has(PermissionsBitField.Flags.ManageGuild);
          } catch {
            manageable = false;
          }
        }
        const botPresent = client.guilds.cache.has(g.id);
        return {
          id: g.id,
          name: g.name,
          icon: g.icon,
          manageable,
          botPresent,
          inviteUrl: botPresent ? null : `${client.getInvite()}&guild_id=${g.id}`,
        };
      })
      .filter((g) => g.manageable)
      .map((guild) => [guild.id, guild])
  );

  if (canViewAllGuilds) {
    for (const guild of client.guilds.cache.values()) {
      guildsById.set(guild.id, {
        id: guild.id,
        name: guild.name,
        icon: guild.icon,
        manageable: true,
        botPresent: true,
        inviteUrl: null,
      });
    }
  }

  const guilds = [...guildsById.values()].sort((a, b) => a.name.localeCompare(b.name));

  res.render("selector", { title: res.locals.t("selector.title"), guilds });
});

module.exports = router;
