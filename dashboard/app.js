const path = require("path");
const express = require("express");
const session = require("express-session");
const MongoStore = require("connect-mongo");
const { initializeMongoose } = require("@src/database/mongoose");
const { createRateLimiter } = require("@src/web/smart-invites/security");
const { applyDashboardSecurityHeaders } = require("./security");
const { ensureCsrfToken } = require("./auth/csrf");

const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000; // short-lived on purpose, see plan doc security notes

/**
 * Boots the SLAYBOT dashboard as an Express app running inside the bot's own
 * process (bot.js requires this module and calls launch(client) when
 * config.DASHBOARD.enabled is true - see src/helpers/Validator.js for the
 * env/config it expects to already be set).
 * @param {import('@structures/BotClient')} client
 */
module.exports.launch = async function launch(client) {
  const connection = await initializeMongoose();
  const config = client.config.DASHBOARD;
  const app = express();

  app.disable("x-powered-by");
  if (config.trustProxy) app.set("trust proxy", 1);
  app.set("view engine", "ejs");
  app.set("views", path.join(__dirname, "views"));

  app.use(express.static(path.join(__dirname, "public")));
  app.use(applyDashboardSecurityHeaders);
  app.use(express.urlencoded({ extended: true }));
  app.use(
    session({
      name: "slaybot_dashboard_sid",
      secret: process.env.SESSION_PASSWORD,
      resave: false,
      saveUninitialized: false,
      rolling: true,
      store: MongoStore.create({
        client: connection.getClient(),
        dbName: connection.name,
        collectionName: "dashboard_sessions",
        stringify: false,
        autoRemove: "interval",
        autoRemoveInterval: 10,
      }),
      cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: SESSION_MAX_AGE_MS,
      },
    })
  );

  app.use((req, _res, next) => {
    req.client = client;
    next();
  });
  app.use((req, res, next) => {
    res.locals.csrfToken = ensureCsrfToken(req);
    res.locals.sessionUser = req.session.user || null;
    res.locals.isOwnerUser = Boolean(req.session.user && client.config.OWNER_IDS.includes(req.session.user.id));
    next();
  });

  app.use(createRateLimiter({ windowMs: 60000, max: 120 }));
  app.use("/auth", createRateLimiter({ windowMs: 60000, max: 20 }), require("./routes/auth"));
  app.use("/", require("./routes/selector"));
  app.use("/g/:guildId", require("./routes/guild"));
  app.use("/owner", require("./routes/owner"));

  app.use((_req, res) => {
    res.status(404).render("error", { title: "Не найдено", message: "Такой страницы не существует." });
  });
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    client.logger.error("Dashboard route error", err);
    res.status(500).render("error", { title: "Внутренняя ошибка", message: "Что-то пошло не так. Попробуйте позже." });
  });

  app.listen(config.port, () => {
    client.logger.success(`Dashboard is listening on port ${config.port}`);
  });

  return app;
};
