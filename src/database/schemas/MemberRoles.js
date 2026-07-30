const mongoose = require("mongoose");

const DEFAULT_RETENTION_DAYS = 90;
const MAX_STORED_ROLES = 100;

const Schema = new mongoose.Schema(
  {
    guild_id: { type: String, required: true },
    user_id: { type: String, required: true },
    roles: { type: [String], default: [] },
    saved_at: { type: Date, default: Date.now },
    // TTL anchor: a snapshot nobody came back for is not kept forever.
    expires_at: { type: Date, required: true },
  },
  { versionKey: false }
);

Schema.index({ guild_id: 1, user_id: 1 }, { unique: true });
Schema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });

const Model = mongoose.models["member-roles"] ? mongoose.model("member-roles") : mongoose.model("member-roles", Schema);

/**
 * Roles worth restoring: everything except @everyone, integration-managed roles
 * and roles the bot could not re-add anyway.
 * @param {import('discord.js').GuildMember} member
 */
function collectRestorableRoles(member) {
  const guild = member.guild;
  const me = guild.members.me;
  const highest = me?.roles?.highest?.position ?? 0;

  return member.roles.cache
    .filter((role) => role.id !== guild.id && !role.managed && role.position < highest)
    .map((role) => role.id)
    .slice(0, MAX_STORED_ROLES);
}

module.exports = {
  model: Model,
  DEFAULT_RETENTION_DAYS,
  MAX_STORED_ROLES,
  collectRestorableRoles,

  /**
   * @param {import('discord.js').GuildMember} member
   * @param {number} [retentionDays]
   */
  saveMemberRoles: async (member, retentionDays = DEFAULT_RETENTION_DAYS) => {
    const roles = collectRestorableRoles(member);
    if (roles.length === 0) return null;

    const now = new Date();
    return Model.findOneAndUpdate(
      { guild_id: member.guild.id, user_id: member.id },
      {
        $set: {
          roles,
          saved_at: now,
          expires_at: new Date(now.getTime() + retentionDays * 24 * 60 * 60 * 1000),
        },
      },
      { upsert: true, new: true }
    ).lean();
  },

  /**
   * @param {string} guildId
   * @param {string} userId
   */
  getMemberRoles: (guildId, userId) => Model.findOne({ guild_id: guildId, user_id: userId }).lean(),

  /**
   * @param {string} guildId
   * @param {string} userId
   */
  clearMemberRoles: (guildId, userId) => Model.deleteOne({ guild_id: guildId, user_id: userId }),

  /**
   * @param {string} guildId
   */
  clearGuildRoles: (guildId) => Model.deleteMany({ guild_id: guildId }),
};
