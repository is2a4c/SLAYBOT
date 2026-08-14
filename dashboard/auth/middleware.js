const { PermissionsBitField } = require("discord.js");
const { getSettings } = require("@schemas/Guild");
const { getStaffAccount } = require("@schemas/StaffAccount");
const { resolveEffectivePermissions } = require("@src/services/dashboard/permissions");
const { dateFormatter } = require("../services/timezone");
const { DEFAULT_LOCALE, translate } = require("../i18n");

// The locale middleware normally puts t() on res.locals. Falling back keeps a guard
// usable from a route mounted before it, and from a unit test, instead of throwing
// while it is already refusing a request.
const t = (res, key, vars) => (res.locals?.t ? res.locals.t(key, vars) : translate(DEFAULT_LOCALE, key, vars));

async function loadDashboardActor(req, res, next) {
  const userId = req.session?.user?.id;
  const isOwner = Boolean(userId && req.client.config.OWNER_IDS.includes(userId));
  let staffAccount = null;

  if (userId && !isOwner) {
    staffAccount = await getStaffAccount(userId).catch((error) => {
      req.client.logger.error("dashboard staff account lookup failed", error);
      return null;
    });
  }

  const effectivePermissions = resolveEffectivePermissions({ isOwner, staffAccount });
  req.staffAccount = staffAccount;
  req.isOwner = isOwner;
  req.dashboardPermissions = effectivePermissions;
  res.locals.isOwnerUser = isOwner;
  res.locals.canAccessOwner = effectivePermissions.has("guilds.view");
  res.locals.canGlobal = (permission) => effectivePermissions.has(permission);
  res.locals.canGuild = () => false;
  next();
}

function requireAuth(req, res, next) {
  if (req.session?.user?.id) return next();
  const basePath = res.locals?.basePath ?? "";
  const redirect = encodeURIComponent(req.originalUrl || `${basePath}/`);
  return res.redirect(`${basePath}/auth/login?redirect=${redirect}`);
}

function requireOwner(req, res, next) {
  requireAuth(req, res, () => {
    if (req.client.config.OWNER_IDS.includes(req.session.user.id)) return next();
    return res.status(403).render("error", {
      title: t(res, "errors.ownerOnlyTitle"),
      message: t(res, "errors.ownerOnlyMessage"),
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
        title: t(res, "errors.guildNotFoundTitle"),
        message: t(res, "errors.guildNotFoundMessage"),
      });
    }

    const settings = await getSettings(guild).catch(() => null);
    // A page rendered for this guild reads in the guild's own clock, not UTC,
    // once one has been configured.
    res.locals.formatDate = dateFormatter(settings?.control_center?.common?.timezone, res.locals.locale);

    const userId = req.session.user.id;
    if (req.isOwner || client.config.OWNER_IDS.includes(userId)) {
      req.guild = guild;
      req.member = guild.members.cache.get(userId) || null;
      req.guildManager = true;
      res.locals.canGuild = () => true;
      return next();
    }

    try {
      const member = guild.members.cache.get(userId) || (await guild.members.fetch(userId).catch(() => null));
      // A role a real admin chose to trust is treated the same as ManageGuild
      // for this guild's dashboard - a deliberate delegation the server made,
      // not a way around Discord's own permission.
      const adminRoleIds = settings?.control_center?.common?.admin_roles || [];
      const hasAdminRole = Boolean(member && adminRoleIds.some((roleId) => member.roles.cache.has(roleId)));
      const guildManager = Boolean(member?.permissions.has(PermissionsBitField.Flags.ManageGuild)) || hasAdminRole;
      const staffViewer = req.dashboardPermissions?.has("guilds.view");
      if (!guildManager && !staffViewer) {
        return res.status(403).render("error", {
          title: t(res, "errors.accessDeniedTitle"),
          message: t(res, "errors.guildAccessDenied"),
        });
      }
      req.guild = guild;
      req.member = member;
      req.guildManager = guildManager;
      res.locals.canGuild = (permission) => guildManager || req.dashboardPermissions?.has(permission);
      return next();
    } catch (ex) {
      req.client.logger.error("dashboard requireGuildAccess failed", ex);
      return res.status(500).render("error", {
        title: t(res, "errors.internalTitle"),
        message: t(res, "errors.permissionCheckFailed"),
      });
    }
  });
}

function requireGuildPermission(permission) {
  return (req, res, next) => {
    if (req.guildManager || req.isOwner || req.dashboardPermissions?.has(permission)) return next();
    return res.status(403).render("error", {
      title: t(res, "errors.insufficientPermissionsTitle"),
      message: t(res, "errors.permissionRequired", { permission }),
    });
  };
}

/**
 * Global (not per-guild) RBAC gate for the Owner/staff surfaces - config.OWNER_IDS
 * always has every permission; anyone else needs a StaffAccount whose role grants it.
 * @param {string} permission - one of ATOMIC_PERMISSIONS
 */
function requirePermission(permission) {
  return (req, res, next) => {
    requireAuth(req, res, () => {
      if (!req.dashboardPermissions?.has(permission)) {
        return res.status(403).render("error", {
          title: t(res, "errors.insufficientPermissionsTitle"),
          message: t(res, "errors.permissionRequired", { permission }),
        });
      }
      return next();
    });
  };
}

module.exports = {
  loadDashboardActor,
  requireAuth,
  requireOwner,
  requireGuildAccess,
  requireGuildPermission,
  requirePermission,
};
