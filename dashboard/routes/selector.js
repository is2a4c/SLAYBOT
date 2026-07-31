const express = require("express");
const router = express.Router();
const { PermissionsBitField } = require("discord.js");
const { requireAuth } = require("../auth/middleware");

function canManageOAuthGuild(guild) {
  if (guild.owner) return true;
  if (!guild.permissions) return false;
  try {
    return new PermissionsBitField(BigInt(guild.permissions)).has(PermissionsBitField.Flags.ManageGuild);
  } catch {
    return false;
  }
}

function buildSelectorGuilds({ oauthGuilds, client }) {
  return (oauthGuilds || [])
    .filter(canManageOAuthGuild)
    .map((guild) => {
      const botPresent = client.guilds.cache.has(guild.id);
      return {
        id: guild.id,
        name: guild.name,
        icon: guild.icon,
        manageable: true,
        botPresent,
        inviteUrl: botPresent ? null : `${client.getInvite()}&guild_id=${guild.id}`,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

router.get("/", requireAuth, (req, res) => {
  const guilds = buildSelectorGuilds({
    oauthGuilds: req.session.user.guilds,
    client: req.client,
  });

  res.render("selector", { title: res.locals.t("selector.title"), guilds });
});

module.exports = router;
module.exports.buildSelectorGuilds = buildSelectorGuilds;
