const { PermissionsBitField } = require("discord.js");
const { getStaffAccount } = require("@schemas/StaffAccount");
const { resolveEffectivePermissions } = require("@src/services/dashboard/permissions");

function requireAuth(req, res, next) {
  if (req.session?.user?.id) return next();
  const redirect = encodeURIComponent(req.originalUrl || `${res.locals.basePath}/`);
  return res.redirect(`${res.locals.basePath}/auth/login?redirect=${redirect}`);
}

function requireOwner(req, res, next) {
  requireAuth(req, res, () => {
    if (req.client.config.OWNER_IDS.includes(req.session.user.id)) return next();
    return res.status(403).render("error", {
      title: "Доступ запрещён",
      message: "Этот раздел доступен только владельцу SLAYBOT.",
    });
  });
}

/**
 * Loads req.params.guildId and verifies the logged-in user may manage it.
 * Never trusts the ManageGuild bit cached in the session from OAuth login -
 * always re-checks live against the bot's own guild/member cache (fetching the
 * member if it isn't cached yet), since a session can outlive a permission change.
 */
async function requireGuildAccess(req, res, next) {
  requireAuth(req, res, async () => {
    const client = req.client;
    const guild = client.guilds.cache.get(req.params.guildId);
    if (!guild) {
      return res.status(404).render("error", {
        title: "Сервер не найден",
        message: "Бот не находится на этом сервере (или он ещё не синхронизирован).",
      });
    }

    const userId = req.session.user.id;
    if (client.config.OWNER_IDS.includes(userId)) {
      req.guild = guild;
      req.member = guild.members.cache.get(userId) || null;
      return next();
    }

    try {
      const member = guild.members.cache.get(userId) || (await guild.members.fetch(userId).catch(() => null));
      if (!member || !member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
        return res.status(403).render("error", {
          title: "Нет доступа",
          message: "У вас нет прав управления этим сервером.",
        });
      }
      req.guild = guild;
      req.member = member;
      return next();
    } catch (ex) {
      req.client.logger.error("dashboard requireGuildAccess failed", ex);
      return res.status(500).render("error", { title: "Ошибка", message: "Не удалось проверить права доступа." });
    }
  });
}

/**
 * Global (not per-guild) RBAC gate for the Owner/staff surfaces - config.OWNER_IDS
 * always has every permission; anyone else needs a StaffAccount whose role grants it.
 * @param {string} permission - one of ATOMIC_PERMISSIONS
 */
function requirePermission(permission) {
  return async (req, res, next) => {
    requireAuth(req, res, async () => {
      const userId = req.session.user.id;
      const isOwner = req.client.config.OWNER_IDS.includes(userId);
      let staffAccount = null;
      if (!isOwner) staffAccount = await getStaffAccount(userId).catch(() => null);

      const effective = resolveEffectivePermissions({ isOwner, staffAccount });
      if (!effective.has(permission)) {
        return res.status(403).render("error", {
          title: "Недостаточно прав",
          message: `Для этого действия требуется право "${permission}".`,
        });
      }
      req.staffAccount = staffAccount;
      req.isOwner = isOwner;
      return next();
    });
  };
}

module.exports = { requireAuth, requireOwner, requireGuildAccess, requirePermission };
