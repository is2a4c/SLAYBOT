const { AuditLogEvent } = require("discord.js");
const { resolveAuditActor, routeEvent } = require("@src/services/eventRouter/EventRouter");

/**
 * @param {import('@src/structures').BotClient} client
 * @param {import('discord.js').Role} role
 */
module.exports = async (client, role) => {
  const actor = await resolveAuditActor(role.guild, { type: AuditLogEvent.RoleCreate, targetId: role.id });
  await routeEvent(role.guild, "ROLE_CREATE", { actor, detail: role.name, logger: client.logger });
};
