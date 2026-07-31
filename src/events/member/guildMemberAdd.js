const { inviteHandler, greetingHandler, memberRoleHandler } = require("@src/handlers");
const { getSettings } = require("@schemas/Guild");

/**
 * @param {import('@src/structures').BotClient} client
 * @param {import('discord.js').GuildMember} member
 */
module.exports = async (client, member) => {
  if (!member || !member.guild) return;

  const { guild } = member;
  const settings = await getSettings(guild);
  if (!member.user.bot) {
    client.telemetry?.record("member_joins", { guildId: guild.id, userId: member.id });
  }

  // Restore roles from a previous membership before autorole, so the snapshot wins
  const restored = await memberRoleHandler
    .restoreRoles(member, settings)
    .catch((err) => client.logger.error("restoreRoles", err));

  // Autorole
  await memberRoleHandler.applyAutoRoles(member, settings).catch((err) => client.logger.error("autorole", err));

  if (restored?.length) {
    client.logger.debug(`Restored ${restored.length} roles for ${member.id} in ${guild.id}`);
  }

  // Check for counter channel
  if (settings.counters.find((doc) => ["MEMBERS", "BOTS", "USERS"].includes(doc.counter_type.toUpperCase()))) {
    if (member.user.bot) {
      settings.data.bots += 1;
      await settings.save();
    }
    if (!client.counterUpdateQueue.includes(guild.id)) client.counterUpdateQueue.push(guild.id);
  }

  // Check if invite tracking is enabled
  const inviterData = settings.invite.tracking ? await inviteHandler.trackJoinedMember(member) : {};

  // Send welcome message
  // A greeting configured with a colour Discord refuses would otherwise reject
  // here, unhandled, and take the rest of the join handling with it.
  greetingHandler.sendWelcome(member, inviterData).catch((err) => client.logger.error("sendWelcome", err));
};
