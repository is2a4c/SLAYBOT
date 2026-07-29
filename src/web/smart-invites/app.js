const express = require("express");
const { applySecurityHeaders, createRateLimiter } = require("./security");
const { normalizeBaseURL } = require("@src/services/smart-invites/config");
const SmartInviteError = require("@src/services/smart-invites/SmartInviteError");
const { SAFE_INVITE_CODE } = require("@src/services/smart-invites/SmartInviteService");
const { renderHome, renderInvite, renderResource, renderStatus } = require("./templates");

const PRIVACY_URL = "https://github.com/is2a4c/SLAYBOT/blob/main/PRIVACY.md";
const TERMS_URL = "https://github.com/is2a4c/SLAYBOT/blob/main/TERMS.md";

function createSmartInvitesApp(service) {
  const app = express();
  const config = service.config;
  app.disable("x-powered-by");
  if (config.trustProxy) app.set("trust proxy", 1);
  app.use(applySecurityHeaders);
  app.use(
    createRateLimiter({
      windowMs: config.publicRateLimitWindowMs,
      max: config.publicRateLimitMax,
    })
  );

  const router = express.Router();
  router.get("/", (_req, res) =>
    res
      .status(200)
      .type("html")
      .send(renderHome(normalizeBaseURL(config.baseURL)))
  );
  router.get("/health", (_req, res) => res.status(200).json({ status: "ok", service: "slaybot-smart-invites" }));
  router.get("/privacy", (_req, res) =>
    res
      .status(200)
      .type("html")
      .send(
        renderResource(
          "Privacy",
          "Политика описывает данные Smart Invites, retention и возможные reverse proxy access logs.",
          PRIVACY_URL,
          "Открыть Privacy Policy"
        )
      )
  );
  router.get("/terms", (_req, res) =>
    res
      .status(200)
      .type("html")
      .send(
        renderResource(
          "Terms",
          "Условия запрещают вредоносные и обманные Smart Invites и описывают ограничения сервиса.",
          TERMS_URL,
          "Открыть Terms"
        )
      )
  );
  router.get("/abuse", (_req, res) =>
    res
      .status(200)
      .type("html")
      .send(
        renderResource(
          "Сообщить о нарушении",
          "Передайте slug ссылки и описание нарушения команде поддержки SLAYBOT.",
          safeSupportURL(service.client.config.SUPPORT_SERVER),
          "Связаться с поддержкой"
        )
      )
  );
  router.get("/robots.txt", (_req, res) => res.status(200).type("text/plain").send("User-agent: *\nDisallow:\n"));

  router.get("/:slug/join", async (req, res) => {
    try {
      const result = await resolvePublicInvite(service, req.params.slug);
      await service.incrementStats(result.record._id, {
        joinButtonClickCount: 1,
        successfulRedirectCount: 1,
      });
      service.audit("smart_invite_redirect_success", result.record, { operation: "join" });
      return res.redirect(302, discordURL(result.record.discordInviteCode));
    } catch (error) {
      return handlePublicError(service, res, error, "join");
    }
  });

  router.get("/:slug", async (req, res) => {
    let record;
    try {
      const found = await service.findBySlug(req.params.slug, { encodedPath: true });
      if (!found) {
        return res
          .status(404)
          .type("html")
          .send(renderStatus("Ссылка не найдена", "Проверьте адрес и попробуйте снова."));
      }
      record = found.record;
      await service.incrementStats(record._id, { clickCount: 1 });
      if (record.status === "deleted" || record.status === "disabled") throw service.statusError(record.status);
      const resolved = await service.ensureUsable(record);

      if (config.redirectMode === "redirect") {
        await service.incrementStats(record._id, { successfulRedirectCount: 1 });
        service.audit("smart_invite_redirect_success", record, { operation: "direct-redirect" });
        return res.redirect(302, discordURL(resolved.record.discordInviteCode));
      }

      await service.incrementStats(record._id, { successfulPreviewCount: 1 });
      const pathPrefix = config.pathPrefix || "";
      return res
        .status(200)
        .type("html")
        .send(
          renderInvite({
            guildName: resolved.guild.name,
            guildIcon: resolved.guild.iconURL?.({ extension: "png", size: 128 }) || null,
            description: service.getPublicDescription(resolved.record),
            channelName: resolved.channel.name,
            joinPath: `${pathPrefix}/${encodeURIComponent(req.params.slug)}/join`,
          })
        );
    } catch (error) {
      return handlePublicError(service, res, error, "preview", record);
    }
  });

  app.use(config.pathPrefix || "/", router);
  app.use((_req, res) =>
    res.status(404).type("html").send(renderStatus("Страница не найдена", "Проверьте адрес и попробуйте снова."))
  );
  return app;
}

async function resolvePublicInvite(service, slug) {
  const found = await service.findBySlug(slug, { encodedPath: true });
  if (!found) throw new SmartInviteError("NOT_FOUND", "Ссылка не найдена.", { httpStatus: 404 });
  if (found.record.status === "deleted" || found.record.status === "disabled") {
    throw service.statusError(found.record.status);
  }
  return service.ensureUsable(found.record);
}

function discordURL(code) {
  if (!SAFE_INVITE_CODE.test(code)) {
    throw new SmartInviteError("INVALID_INVITE_CODE", "Внутреннее приглашение повреждено.", {
      httpStatus: 503,
    });
  }
  return `https://discord.gg/${code}`;
}

function safeSupportURL(value) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (
      url.protocol === "https:" &&
      ["discord.gg", "discord.com"].includes(url.hostname) &&
      !url.username &&
      !url.password
    ) {
      return url.toString();
    }
  } catch {
    return null;
  }
  return null;
}

async function handlePublicError(service, res, error, operation, record) {
  if (record?._id) await service.incrementStats(record._id, { failedRedirectCount: 1 }).catch(() => {});
  if (record) {
    service.audit("smart_invite_redirect_failed", record, {
      operation,
      errorCode: error.code || "INTERNAL_ERROR",
    });
  }
  const known = error instanceof SmartInviteError;
  const status = known ? error.httpStatus : 503;
  const title =
    error.code === "LINK_DISABLED"
      ? "Ссылка отключена"
      : error.code === "LINK_DELETED"
        ? "Ссылка удалена"
        : error.code === "REGENERATION_IN_PROGRESS"
          ? "Ссылка восстанавливается"
          : status === 404
            ? "Ссылка не найдена"
            : "Приглашение временно недоступно";
  return res
    .status(status)
    .type("html")
    .send(renderStatus(title, known ? error.safeMessage : "Попробуйте открыть ссылку позже."));
}

module.exports = {
  createSmartInvitesApp,
  resolvePublicInvite,
  discordURL,
  safeSupportURL,
};
