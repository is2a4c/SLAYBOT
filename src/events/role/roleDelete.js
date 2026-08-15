const { AuditLogEvent } = require("discord.js");
const { resolveAuditActor, routeEvent } = require("@src/services/eventRouter/EventRouter");

/**
 * @param {import('@src/structures').BotClient} client
 * @param {import('discord.js').Role} role
 */
module.exports = async (client, role) => {
  const actor = await resolveAuditActor(role.guild, { type: AuditLogEvent.RoleDelete, targetId: role.id });
  await routeEvent(role.guild, "ROLE_DELETE", { actor, detail: role.name, logger: client.logger });
};
