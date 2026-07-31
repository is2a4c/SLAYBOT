const express = require("express");
const router = express.Router();
const { buildAuthorizeURL, exchangeCode, fetchDiscordUser, fetchDiscordGuilds } = require("../auth/oauth");
const { createState, consumeState } = require("../auth/state");
const { requireCsrf } = require("../auth/csrf");
const { normalizedBaseURL } = require("../app");

router.get("/login", (req, res) => {
  if (!req.client.user?.id) {
    return res.status(503).render("error", {
      title: res.locals.t("errors.botNotReadyTitle"),
      message: res.locals.t("errors.botNotReadyMessage"),
    });
  }
  const redirectTo = typeof req.query.redirect === "string" ? req.query.redirect : `${res.locals.basePath}/`;
  const state = createState(req, redirectTo, res.locals.basePath);
  const config = req.client.config.DASHBOARD;

  res.redirect(
    buildAuthorizeURL({
      clientId: req.client.user.id,
      redirectUri: `${normalizedBaseURL(config.baseURL)}/auth/callback`,
      state,
    })
  );
});

router.get("/callback", async (req, res) => {
  const { code, state } = req.query;
  const redirectTo = consumeState(req, state);
  const config = req.client.config.DASHBOARD;

  if (!code || redirectTo === null) {
    req.client.logger.debug("Dashboard OAuth callback rejected: missing code or invalid/expired state");
    return res.redirect(`${res.locals.basePath}/`);
  }

  try {
    const token = await exchangeCode({
      code,
      clientId: req.client.user.id,
      clientSecret: process.env.BOT_SECRET,
      redirectUri: `${normalizedBaseURL(config.baseURL)}/auth/callback`,
    });
    const [profile, guilds] = await Promise.all([
      fetchDiscordUser({ accessToken: token.accessToken }),
      fetchDiscordGuilds({ accessToken: token.accessToken }),
    ]);

    const sessionUser = {
      id: profile.id,
      username: profile.username,
      globalName: profile.global_name || null,
      avatar: profile.avatar || null,
      guilds: guilds.map((g) => ({
        id: g.id,
        name: g.name,
        icon: g.icon,
        owner: Boolean(g.owner),
        permissions: g.permissions,
      })),
    };

    // Regenerate the session on privilege change (anonymous -> authenticated) to
    // prevent session fixation.
    req.session.regenerate((regenerateErr) => {
      if (regenerateErr) {
        req.client.logger.error("dashboard session regenerate failed", regenerateErr);
        return res.redirect(`${res.locals.basePath}/`);
      }
      req.session.user = sessionUser;
      req.session.save((saveErr) => {
        if (saveErr) {
          req.client.logger.error("dashboard session save failed", saveErr);
          return res.redirect(`${res.locals.basePath}/`);
        }
        res.redirect(redirectTo);
      });
    });
  } catch (ex) {
    req.client.logger.error("dashboard oauth callback failed", ex);
    res.redirect(`${res.locals.basePath}/`);
  }
});

router.post("/logout", requireCsrf, (req, res) => {
  const basePath = res.locals.basePath;
  req.session.destroy(() => res.redirect(`${basePath}/`));
});

module.exports = router;
