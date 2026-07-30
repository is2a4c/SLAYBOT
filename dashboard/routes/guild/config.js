const express = require("express");
const router = express.Router();
const { getSettings } = require("@schemas/Guild");
const { applyGuildConfigPatch } = require("@src/services/dashboard/guildConfig");
const { requireCsrf } = require("../../auth/csrf");

const SNOWFLAKE = /^\d{17,20}$/;

function channelOrNull(guild, value) {
  if (!value || !SNOWFLAKE.test(value)) return null;
  return guild.channels.cache.has(value) ? value : null;
}

function textChannels(guild) {
  return [...guild.channels.cache.filter((c) => c.isTextBased() && !c.isThread()).values()];
}

router.get("/", async (req, res) => {
  const { guild } = req;
  const settings = await getSettings(guild);
  res.render("guild/config", {
    title: `${res.locals.t("config.title")} — ${guild.name}`,
    guild,
    settings,
    textChannels: textChannels(guild),
    roles: [...guild.roles.cache.filter((r) => r.id !== guild.id && !r.managed).values()],
  });
});

router.post("/", requireCsrf, async (req, res) => {
  const { guild } = req;
  const body = req.body;

  const patch = {
    prefix:
      String(body.prefix || "!")
        .trim()
        .slice(0, 5) || "!",
    modlog_channel: channelOrNull(guild, body.modlog_channel),
    "welcome.enabled": body.welcome_enabled === "on",
    "welcome.channel": channelOrNull(guild, body.welcome_channel),
    "welcome.content": String(body.welcome_content || "").slice(0, 1000),
    "farewell.enabled": body.farewell_enabled === "on",
    "farewell.channel": channelOrNull(guild, body.farewell_channel),
    "farewell.content": String(body.farewell_content || "").slice(0, 1000),
    "stats.enabled": body.stats_enabled === "on",
    "suggestions.enabled": body.suggestions_enabled === "on",
    "suggestions.channel_id": channelOrNull(guild, body.suggestions_channel_id),
    autorole: String(body.autorole || "")
      .split(",")
      .map((id) => id.trim())
      .filter((id) => SNOWFLAKE.test(id) && guild.roles.cache.has(id))
      .slice(0, 10),
  };

  await applyGuildConfigPatch(guild, patch, {
    id: req.session.user.id,
    tag: req.session.user.username,
    action: "guild_config_update",
    reason: "Dashboard: base configuration",
  });

  res.redirect(`${res.locals.basePath}/g/${guild.id}/config`);
});

module.exports = router;
