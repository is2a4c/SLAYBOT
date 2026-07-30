const express = require("express");
const router = express.Router();
const { PermissionsBitField } = require("discord.js");
const { requireAuth } = require("../auth/middleware");

router.get("/", requireAuth, (req, res) => {
  const client = req.client;
  const userId = req.session.user.id;
  const isOwnerUser = client.config.OWNER_IDS.includes(userId);

  const guilds = (req.session.user.guilds || [])
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
    .filter((g) => g.manageable);

  res.render("selector", { title: res.locals.t("selector.title"), guilds, isOwnerUser });
});

module.exports = router;
