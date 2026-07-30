const express = require("express");
const router = express.Router();
const ModUtils = require("@helpers/ModUtils");
const { getMember } = require("@schemas/Member");
const { model: ModLogModel } = require("@schemas/ModLog");
const { logAudit } = require("@src/services/dashboard/auditLog");
const { requireCsrf } = require("../../auth/csrf");

const MAX_TIMEOUT_MS = 28 * 24 * 60 * 60 * 1000; // Discord's own cap
const TIMEOUT_OPTIONS_MIN = { 10: 10, 60: 60, 360: 360, 1440: 1440, 10080: 10080 };

const ERROR_MESSAGES = {
  MEMBER_PERM: "Вы не можете модерировать этого участника (его роль выше или равна вашей).",
  BOT_PERM: "У бота недостаточно прав/позиции роли для этого действия.",
  ALREADY_TIMEOUT: "Участник уже находится в таймауте.",
  ERROR: "Не удалось выполнить действие. Подробности в логах бота.",
};

async function loadTarget(req, res, next) {
  const { guild } = req;
  const userId = req.params.userId;
  if (!/^\d{17,20}$/.test(userId)) {
    return res
      .status(404)
      .render("error", { title: res.locals.t("errors.notFoundTitle"), message: res.locals.t("errors.invalidUserId") });
  }

  const member = guild.members.cache.get(userId) || (await guild.members.fetch(userId).catch(() => null));
  const user = member?.user || (await req.client.users.fetch(userId).catch(() => null));
  if (!user) {
    return res
      .status(404)
      .render("error", { title: res.locals.t("errors.notFoundTitle"), message: res.locals.t("errors.userNotFound") });
  }

  req.targetMember = member;
  req.targetUser = user;
  next();
}

router.get("/:userId", loadTarget, async (req, res) => {
  const { guild } = req;
  const userId = req.params.userId;

  const [memberDb, modLogs, banInfo] = await Promise.all([
    getMember(guild.id, userId),
    ModLogModel.find({ guild_id: guild.id, member_id: userId }).sort({ created_at: -1 }).limit(20).lean(),
    guild.bans.fetch(userId).catch(() => null),
  ]);

  res.render("guild/member-card", {
    title: `${req.targetUser.username} — ${guild.name}`,
    guild,
    member: req.targetMember,
    user: req.targetUser,
    memberDb,
    modLogs,
    isBanned: Boolean(banInfo),
    timeoutOptions: TIMEOUT_OPTIONS_MIN,
    error: typeof req.query.error === "string" ? req.query.error : null,
  });
});

router.post("/:userId/actions", requireCsrf, loadTarget, async (req, res) => {
  const { guild } = req;
  const userId = req.params.userId;
  const action = String(req.body.action || "");
  const reason = String(req.body.reason || "")
    .trim()
    .slice(0, 480);
  const backTo = `${res.locals.basePath}/g/${guild.id}/members/${userId}`;

  if (reason.length < 3) {
    return res.redirect(`${backTo}?error=${encodeURIComponent("Укажите причину (минимум 3 символа).")}`);
  }

  // The dashboard user acts as themselves when they're a member of this guild
  // (so Discord's own role-hierarchy rules apply exactly as in slash commands);
  // otherwise (e.g. a global Owner managing a guild they don't belong to) the
  // bot's own member acts as issuer for the hierarchy check.
  const issuer = req.member || guild.members.me;

  let result;
  try {
    switch (action) {
      case "warn":
        if (!req.targetMember) return res.redirect(`${backTo}?error=${encodeURIComponent("Участник покинул сервер.")}`);
        result = await ModUtils.warnTarget(issuer, req.targetMember, reason);
        break;
      case "timeout": {
        if (!req.targetMember) return res.redirect(`${backTo}?error=${encodeURIComponent("Участник покинул сервер.")}`);
        const minutes = TIMEOUT_OPTIONS_MIN[req.body.durationMinutes] || 60;
        const ms = Math.min(MAX_TIMEOUT_MS, minutes * 60 * 1000);
        result = await ModUtils.timeoutTarget(issuer, req.targetMember, ms, reason);
        break;
      }
      case "kick":
        if (!req.targetMember) return res.redirect(`${backTo}?error=${encodeURIComponent("Участник покинул сервер.")}`);
        result = await ModUtils.kickTarget(issuer, req.targetMember, reason);
        break;
      case "ban":
        result = await ModUtils.banTarget(issuer, req.targetUser, reason);
        break;
      case "unban":
        result = await ModUtils.unBanTarget(issuer, req.targetUser, reason);
        break;
      default:
        return res.redirect(`${backTo}?error=${encodeURIComponent("Неизвестное действие.")}`);
    }
  } catch (ex) {
    req.client.logger.error(`dashboard member action failed (${action})`, ex);
    return res.redirect(`${backTo}?error=${encodeURIComponent(ERROR_MESSAGES.ERROR)}`);
  }

  if (result !== true) {
    return res.redirect(`${backTo}?error=${encodeURIComponent(ERROR_MESSAGES[result] || ERROR_MESSAGES.ERROR)}`);
  }

  await logAudit({
    actorId: req.session.user.id,
    actorTag: req.session.user.username,
    action: `member_${action}`,
    guildId: guild.id,
    targetType: "member",
    targetId: userId,
    reason,
  });

  res.redirect(backTo);
});

module.exports = router;
