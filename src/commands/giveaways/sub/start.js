const { ChannelType } = require("discord.js");
const {
  calculateBonusEntries,
  describeRequirements,
  evaluateEligibility,
  needsMemberData,
  normalizeRequirements,
} = require("@helpers/GiveawayRequirements");

/**
 * Effective invites of a member, mirroring the invite tracker's own formula.
 * @param {object} inviteData
 */
const effectiveInvites = (inviteData = {}) =>
  inviteData.tracked + inviteData.added - inviteData.fake - inviteData.left || 0;

/**
 * Look up the numbers that requirements can depend on. Only called when the
 * giveaway actually uses a level or invite requirement.
 * @param {import('discord.js').GuildMember} member
 */
async function loadMemberFacts(member) {
  const [{ getMemberStats }, { getMember }] = [require("@schemas/MemberStats"), require("@schemas/Member")];

  const [stats, memberDb] = await Promise.all([
    getMemberStats(member.guild.id, member.id).catch(() => null),
    getMember(member.guild.id, member.id).catch(() => null),
  ]);

  return {
    level: stats?.level || 0,
    invites: effectiveInvites(memberDb?.invite_data),
  };
}

/**
 * @param {import('discord.js').GuildMember} member
 * @param {import('discord.js').GuildTextBasedChannel} giveawayChannel
 * @param {number} duration
 * @param {string} prize
 * @param {number} winners
 * @param {import('discord.js').User} [host]
 * @param {string[]} [allowedRoles]
 * @param {object} [requirements] extra entry requirements, see @helpers/GiveawayRequirements
 */
module.exports = async (
  member,
  giveawayChannel,
  duration,
  prize,
  winners,
  host,
  allowedRoles = [],
  requirements = {}
) => {
  try {
    if (!host) host = member.user;
    if (!member.permissions.has("ManageMessages")) {
      return "You need to have the manage messages permissions to start giveaways.";
    }

    if (giveawayChannel.type !== ChannelType.GuildText) {
      return "You can only start giveaways in text channels.";
    }

    const rules = normalizeRequirements({ ...requirements, allowedRoles });
    const requirementLines = describeRequirements(rules);

    /**
     * @type {import("discord-giveaways").GiveawayStartOptions}
     */
    const options = {
      duration: duration,
      prize,
      winnerCount: winners,
      hostedBy: host,
      thumbnail: "https://i.imgur.com/DJuTuxs.png",
      messages: {
        giveaway: "🎉 **GIVEAWAY** 🎉",
        giveawayEnded: "🎉 **GIVEAWAY ENDED** 🎉",
        inviteToParticipate: requirementLines.length
          ? `React with 🎁 to enter\n\n**Requirements**\n${requirementLines.map((line) => `• ${line}`).join("\n")}`
          : "React with 🎁 to enter",
        dropMessage: "Be the first to react with 🎁 to win!",
        hostedBy: `\nHosted by: ${host.username}`,
      },
    };

    const requiresLookup = needsMemberData(rules);

    // discord-giveaways awaits this, so the database read is safe here.
    options.exemptMembers = async (entrant) => {
      try {
        const facts = requiresLookup ? await loadMemberFacts(entrant) : {};
        const { eligible } = evaluateEligibility({
          requirements: rules,
          member: {
            roleIds: entrant.roles.cache.map((role) => role.id),
            level: facts.level,
            invites: facts.invites,
            accountCreatedAt: entrant.user.createdTimestamp,
            joinedAt: entrant.joinedTimestamp,
          },
        });
        return !eligible;
      } catch (error) {
        entrant.client.logger?.error("Giveaway requirement check", error);
        // A failed lookup must not silently disqualify someone.
        return false;
      }
    };

    if (rules.bonus) {
      options.bonusEntries = [
        {
          bonus: (entrant) =>
            calculateBonusEntries({ requirements: rules, roleIds: entrant.roles.cache.map((role) => role.id) }),
          cumulative: false,
        },
      ];
    }

    await member.client.giveawaysManager.start(giveawayChannel, options);

    return requirementLines.length
      ? `Giveaway started in ${giveawayChannel} with ${requirementLines.length} requirement(s).`
      : `Giveaway started in ${giveawayChannel}`;
  } catch (error) {
    member.client.logger.error("Giveaway Start", error);
    return `An error occurred while starting the giveaway: ${error.message}`;
  }
};
