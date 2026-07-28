function getTicketMetadata(channel) {
  if (!channel?.topic?.startsWith("tіcket|")) return null;

  const [, ownerId, categoryName] = channel.topic.split("|");
  if (!ownerId) return null;

  return {
    ownerId,
    categoryName: categoryName || "Default",
  };
}

function getMemberRoleIds(member) {
  if (!member?.roles) return [];
  if (member.roles.cache) return [...member.roles.cache.keys()];
  if (Array.isArray(member.roles)) return member.roles;
  return [];
}

function memberHasPermission(member, permission) {
  return Boolean(member?.permissions?.has?.(permission));
}

function getTicketStaffRoleIds(settings, channel) {
  const roleIds = new Set(settings?.ticket?.staff_roles || []);
  const metadata = getTicketMetadata(channel);

  if (metadata?.categoryName && metadata.categoryName !== "Default") {
    const category = settings?.ticket?.categories?.find((entry) => entry.name === metadata.categoryName);
    category?.staff_roles?.forEach((roleId) => roleIds.add(roleId));
  }

  return [...roleIds];
}

function isTicketStaff(member, settings, channel) {
  if (memberHasPermission(member, "ManageGuild")) return true;

  const memberRoleIds = new Set(getMemberRoleIds(member));
  return getTicketStaffRoleIds(settings, channel).some((roleId) => memberRoleIds.has(roleId));
}

function canCloseTicket(member, userId, settings, channel) {
  const metadata = getTicketMetadata(channel);
  return metadata?.ownerId === userId || isTicketStaff(member, settings, channel);
}

function parseRoleIds(input) {
  if (!input) return [];
  return [...new Set(input.match(/\d{17,20}/g) || [])];
}

async function syncStaffRoleAccess(channels, settings, role, enabled) {
  let updated = 0;
  let failed = 0;

  for (const [, channel] of channels) {
    try {
      const metadata = getTicketMetadata(channel);
      const category = (settings.ticket.categories || []).find((entry) => entry.name === metadata?.categoryName);
      const remainsCategoryStaff = category?.staff_roles?.includes(role.id);

      if (enabled || remainsCategoryStaff) {
        await channel.permissionOverwrites.edit(role, {
          ViewChannel: true,
          SendMessages: true,
          ReadMessageHistory: true,
        });
      } else {
        await channel.permissionOverwrites.delete(role);
      }
      updated += 1;
    } catch {
      failed += 1;
    }
  }

  return { updated, failed };
}

async function syncCategoryStaffRoleAccess(channels, settings, categoryName, role, enabled) {
  let updated = 0;
  let failed = 0;
  const roleId = role.id || role;
  const remainsGlobalStaff = (settings.ticket.staff_roles || []).includes(roleId);

  for (const [, channel] of channels) {
    const metadata = getTicketMetadata(channel);
    if (metadata?.categoryName !== categoryName) continue;

    try {
      if (enabled || remainsGlobalStaff) {
        await channel.permissionOverwrites.edit(role, {
          ViewChannel: true,
          SendMessages: true,
          ReadMessageHistory: true,
        });
      } else {
        await channel.permissionOverwrites.delete(role);
      }
      updated += 1;
    } catch {
      failed += 1;
    }
  }

  return { updated, failed };
}

module.exports = {
  canCloseTicket,
  getMemberRoleIds,
  getTicketMetadata,
  getTicketStaffRoleIds,
  isTicketStaff,
  memberHasPermission,
  parseRoleIds,
  syncCategoryStaffRoleAccess,
  syncStaffRoleAccess,
};
