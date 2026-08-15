const { inviteHandler, greetingHandler, memberRoleHandler } = require("@src/handlers");
const { getSettings } = require("@schemas/Guild");
const { deleteMemberStats } = require("@schemas/MemberStats");
const { resetOnLeave } = require("@src/services/stats/RankingPolicy");

/**
 * @param {import('@src/structures').BotClient} client
 * @param {import('discord.js').GuildMember|import('discord.js').PartialGuildMember} member
 */
module.exports = async (client, member) => {
  if (member.partial) await member.user.fetch();
  if (!member.guild) return;

  const { guild } = member;
  const settings = await getSettings(guild);
  if (!member.user.bot) {
    client.telemetry?.record("member_leaves", { guildId: guild.id, userId: member.id });
  }

  // Snapshot roles first - the member object still carries them here
  if (!member.partial) {
    await memberRoleHandler.saveRoles(member, settings).catch((err) => client.logger.error("saveRoles", err));
  }

  // Check for counter channel
  if (settings.counters.find((doc) => ["MEMBERS", "BOTS", "USERS"].includes(doc.counter_type.toUpperCase()))) {
    if (member.user.bot) {
      settings.data.bots -= 1;
      await settings.save();
    }
    if (!client.counterUpdateQueue.includes(guild.id)) client.counterUpdateQueue.push(guild.id);
  }

  // A server that wants a clean slate for a rejoin clears ranking progress -
  // never blocks the rest of the leave handling if it fails.
  if (resetOnLeave(settings)) {
    await deleteMemberStats(guild.id, member.id).catch((err) => client.logger.error("resetRankingOnLeave", err));
  }

  // Invite Tracker
  const inviterData = await inviteHandler.trackLeftMember(guild, member.user);

  // Farewell message
  greetingHandler.sendFarewell(member, inviterData).catch((err) => client.logger.error("sendFarewell", err));
};
