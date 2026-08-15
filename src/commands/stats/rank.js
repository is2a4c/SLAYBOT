const { AttachmentBuilder, ApplicationCommandOptionType } = require("discord.js");
const { getMemberStats, getXpLb } = require("@schemas/MemberStats");
const { buildRankCardUrl, fetchRankCard } = require("@src/services/stats/RankCard");

/**
 * @type {import("@structures/Command")}
 */
module.exports = {
  name: "rank",
  description: "displays members rank in this server",
  cooldown: 5,
  category: "STATS",
  botPermissions: ["AttachFiles"],
  command: {
    enabled: true,
    usage: "[@member|id]",
  },
  slashCommand: {
    enabled: true,
    options: [
      {
        name: "user",
        description: "target user",
        type: ApplicationCommandOptionType.User,
        required: false,
      },
    ],
  },

  async messageRun(message, args, data) {
    const member = (await message.guild.resolveMember(args[0])) || message.member;
    const response = await getRank(message, member, data.settings);
    await message.safeReply(response);
  },

  async interactionRun(interaction, data) {
    const user = interaction.options.getUser("user") || interaction.user;
    const member = await interaction.guild.members.fetch(user);
    const response = await getRank(interaction, member, data.settings);
    await interaction.safeFollowUp(response);
  },
};

async function getRank({ guild }, member, settings) {
  const { user } = member;
  if (!settings.stats.enabled) return "Stats Tracking is disabled on this server";

  const memberStats = await getMemberStats(guild.id, user.id);
  if (!memberStats.xp) return `${user.username} is not ranked yet!`;

  const lb = await getXpLb(guild.id, 100);
  let pos = -1;
  lb.forEach((doc, i) => {
    if (doc.member_id == user.id) {
      pos = i + 1;
    }
  });

  // The same multiplier the level-up math itself uses, so the card never
  // shows a "next level" bar that disagrees with when the member actually levels.
  const multiplier = Math.min(10000, Math.max(10, Number(settings?.stats?.xp?.level_multiplier) || 100));
  const xpNeeded = memberStats.level * memberStats.level * multiplier;
  const rank = pos !== -1 ? pos : 0;

  const url = buildRankCardUrl({
    user,
    level: memberStats.level,
    xp: memberStats.xp,
    xpNeeded,
    rank,
    presenceStatus: member?.presence?.status?.toString(),
    settings,
  });

  const response = await fetchRankCard(url);
  if (!response.success) return "Failed to generate rank-card";

  const attachment = new AttachmentBuilder(response.buffer, { name: "rank.png" });
  return { files: [attachment] };
}
