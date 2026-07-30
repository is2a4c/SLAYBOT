const path = require("path");
const express = require("express");
const session = require("express-session");
const MongoStore = require("connect-mongo");
const { initializeMongoose } = require("@src/database/mongoose");
const { createRateLimiter } = require("@src/web/smart-invites/security");
const { applyDashboardSecurityHeaders } = require("./security");
const { ensureCsrfToken } = require("./auth/csrf");
const { localeMiddleware } = require("./i18n");

const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000; // short-lived on purpose, see plan doc security notes

/**
 * The dashboard shares a public domain/port with another service (Smart
 * Invites) behind an external reverse proxy the user manages on a separate
 * VM. That proxy strips its path prefix before forwarding (e.g. a request the
 * browser sent to /dashboard/g/123 arrives here as plain /g/123) - so Express
 * mounts everything at the process root, matching what actually arrives.
 * The browser never sees that stripping though: every link/redirect this app
 * generates still needs the public prefix, taken from the path portion of
 * config.DASHBOARD.baseURL, so the next click still goes through the proxy
 * correctly. That's res.locals.basePath below - a fixed value from config,
 * deliberately not req.baseUrl (which would reflect the already-stripped,
 * root-mounted path instead).
 * @param {string} baseURL
 */
function publicBasePath(baseURL) {
  try {
    return new URL(baseURL).pathname.replace(/\/$/, "");
  } catch {
    return "";
  }
}
module.exports.publicBasePath = publicBasePath;

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
  const basePath = publicBasePath(config.baseURL);
  const app = express();
  const dashboardRouter = express.Router();

  app.disable("x-powered-by");
  if (config.trustProxy) app.set("trust proxy", 1);
  app.set("view engine", "ejs");
  app.set("views", path.join(__dirname, "views"));

  dashboardRouter.use((_req, res, next) => {
    res.locals.basePath = basePath;
    next();
  });
  // Language for every rendered page: ?lang= wins, then the cookie, then the browser
  dashboardRouter.use(localeMiddleware);
  dashboardRouter.use(express.static(path.join(__dirname, "public")));
  dashboardRouter.use(applyDashboardSecurityHeaders);
  dashboardRouter.use(express.urlencoded({ extended: true }));
  dashboardRouter.use(
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
        // Deliberately "/", not basePath: express-session only attaches
        // req.session when the incoming request path is compatible with
        // cookie.path (a real, verified requirement - not just a browser-side
        // nicety). Since the app is mounted at the process root (see above),
        // every request it actually sees is root-relative, so the cookie path
        // must be too. The trade-off is the browser also sends this cookie to
        // sibling services on the same domain (e.g. Smart Invites) - harmless
        // since they never read req.session.
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: SESSION_MAX_AGE_MS,
      },
    })
  );

  dashboardRouter.use((req, _res, next) => {
    req.client = client;
    next();
  });
  dashboardRouter.use((req, res, next) => {
    res.locals.csrfToken = ensureCsrfToken(req);
    res.locals.sessionUser = req.session.user || null;
    res.locals.isOwnerUser = Boolean(req.session.user && client.config.OWNER_IDS.includes(req.session.user.id));
    next();
  });

  dashboardRouter.use(createRateLimiter({ windowMs: 60000, max: 120 }));
  dashboardRouter.use("/auth", createRateLimiter({ windowMs: 60000, max: 20 }), require("./routes/auth"));
  // Public: no session required, carries health only (see routes/status.js)
  dashboardRouter.use("/status", require("./routes/status"));
  dashboardRouter.use("/", require("./routes/selector"));
  dashboardRouter.use("/g/:guildId", require("./routes/guild"));
  dashboardRouter.use("/owner", require("./routes/owner"));

  dashboardRouter.use((_req, res) => {
    res.status(404).render("error", {
      title: res.locals.t("errors.notFoundTitle"),
      message: res.locals.t("errors.notFoundMessage"),
    });
  });
  // eslint-disable-next-line no-unused-vars
  dashboardRouter.use((err, req, res, _next) => {
    client.logger.error("Dashboard route error", err);
    res.status(500).render("error", {
      title: res.locals.t("errors.internalTitle"),
      message: res.locals.t("errors.internalMessage"),
    });
  });

  app.use(dashboardRouter);

  const server = app.listen(config.port, () => {
    client.logger.success(`Dashboard is listening on port ${config.port} (public path: ${basePath || "/"})`);
  });

  return { app, server };
};
