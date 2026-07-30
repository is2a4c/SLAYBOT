const crypto = require("crypto");
const { ChannelType, OverwriteType } = require("discord.js");

const SUPPORTED_CHANNEL_TYPES = [
  ChannelType.GuildText,
  ChannelType.GuildVoice,
  ChannelType.GuildAnnouncement,
  ChannelType.GuildStageVoice,
  ChannelType.GuildForum,
  ChannelType.GuildCategory,
];

class BackupError extends Error {
  constructor(message) {
    super(message);
    this.name = "BackupError";
  }
}

function newBackupId() {
  return crypto.randomBytes(4).toString("hex");
}

/**
 * Serialise a channel's permission overwrites by role name.
 *
 * Names, not ids: a restore into a rebuilt server has new role ids, and a name
 * is the only thing that survives.
 *
 * @param {import('discord.js').GuildChannel} channel
 */
function serializeOverwrites(channel) {
  return [...channel.permissionOverwrites.cache.values()]
    .filter((overwrite) => overwrite.type === OverwriteType.Role)
    .map((overwrite) => ({
      role: channel.guild.roles.cache.get(overwrite.id)?.name || null,
      allow: overwrite.allow.bitfield.toString(),
      deny: overwrite.deny.bitfield.toString(),
    }))
    .filter((entry) => entry.role);
}

/**
 * Take a structural snapshot of a guild: roles, categories, channels, settings.
 * Messages and member data are deliberately never stored.
 *
 * @param {import('discord.js').Guild} guild
 */
function snapshotGuild(guild) {
  const roles = [...guild.roles.cache.values()]
    .filter((role) => !role.managed && role.id !== guild.id)
    .sort((a, b) => b.position - a.position)
    .map((role) => ({
      name: role.name,
      color: role.hexColor,
      hoist: role.hoist,
      mentionable: role.mentionable,
      permissions: role.permissions.bitfield.toString(),
      position: role.position,
    }));

  const channels = [...guild.channels.cache.values()]
    .filter((channel) => SUPPORTED_CHANNEL_TYPES.includes(channel.type))
    .sort((a, b) => a.rawPosition - b.rawPosition)
    .map((channel) => ({
      name: channel.name,
      type: channel.type,
      parent: channel.parent?.name || null,
      position: channel.rawPosition,
      topic: "topic" in channel ? channel.topic || null : null,
      nsfw: "nsfw" in channel ? Boolean(channel.nsfw) : false,
      rateLimitPerUser: "rateLimitPerUser" in channel ? channel.rateLimitPerUser || 0 : 0,
      bitrate: "bitrate" in channel ? channel.bitrate : null,
      userLimit: "userLimit" in channel ? channel.userLimit : null,
      overwrites: serializeOverwrites(channel),
    }));

  return {
    version: 1,
    guild: {
      name: guild.name,
      iconURL: guild.iconURL({ extension: "png", size: 512 }) || null,
      verificationLevel: guild.verificationLevel,
      explicitContentFilter: guild.explicitContentFilter,
      defaultMessageNotifications: guild.defaultMessageNotifications,
      afkTimeout: guild.afkTimeout,
      systemChannel: guild.systemChannel?.name || null,
    },
    roles,
    // Emoji are stored as urls: re-uploading them needs the image, not the id.
    emojis: [...guild.emojis.cache.values()].map((emoji) => ({
      name: emoji.name,
      url: emoji.imageURL({ extension: emoji.animated ? "gif" : "png" }),
      animated: emoji.animated,
    })),
    channels,
    takenAt: new Date().toISOString(),
  };
}

/**
 * Work out what a restore would add, without touching Discord.
 *
 * Restores only ever add what is missing. Nothing existing is renamed, moved or
 * deleted, so a mistaken `/backup load` can never wipe a live server.
 *
 * @param {{snapshot: object, existingRoles: string[], existingChannels: string[]}} input
 * @returns {{roles: object[], categories: object[], channels: object[]}}
 */
function planRestore({ snapshot, existingRoles, existingChannels }) {
  const haveRole = new Set((existingRoles || []).map((name) => name.toLowerCase()));
  const haveChannel = new Set((existingChannels || []).map((name) => name.toLowerCase()));

  const roles = (snapshot.roles || []).filter((role) => !haveRole.has(role.name.toLowerCase()));

  const missingChannels = (snapshot.channels || []).filter((channel) => !haveChannel.has(channel.name.toLowerCase()));

  return {
    roles,
    // Categories first: a channel cannot be parented to a category that does not exist yet.
    categories: missingChannels.filter((channel) => channel.type === ChannelType.GuildCategory),
    channels: missingChannels.filter((channel) => channel.type !== ChannelType.GuildCategory),
  };
}

/**
 * Apply a restore plan.
 * @param {{guild: import('discord.js').Guild, snapshot: object, plan: object, reason?: string}} input
 */
async function applyRestore({ guild, plan, reason = "Backup restore" }) {
  const created = { roles: 0, categories: 0, channels: 0, failed: [] };

  for (const role of plan.roles) {
    try {
      await guild.roles.create({
        name: role.name,
        color: role.color,
        hoist: role.hoist,
        mentionable: role.mentionable,
        permissions: BigInt(role.permissions),
        reason,
      });
      created.roles += 1;
    } catch {
      created.failed.push(`role ${role.name}`);
    }
  }

  const categoryByName = new Map();
  for (const category of plan.categories) {
    try {
      const channel = await guild.channels.create({ name: category.name, type: ChannelType.GuildCategory, reason });
      categoryByName.set(category.name.toLowerCase(), channel.id);
      created.categories += 1;
    } catch {
      created.failed.push(`category ${category.name}`);
    }
  }

  for (const channel of plan.channels) {
    try {
      const parentId =
        (channel.parent && categoryByName.get(channel.parent.toLowerCase())) ||
        guild.channels.cache.find(
          (existing) => existing.type === ChannelType.GuildCategory && existing.name === channel.parent
        )?.id ||
        undefined;

      await guild.channels.create({
        name: channel.name,
        type: channel.type,
        parent: parentId,
        topic: channel.topic || undefined,
        nsfw: channel.nsfw || undefined,
        rateLimitPerUser: channel.rateLimitPerUser || undefined,
        bitrate: channel.bitrate || undefined,
        userLimit: channel.userLimit || undefined,
        permissionOverwrites: (channel.overwrites || [])
          .map((overwrite) => {
            const role = guild.roles.cache.find((candidate) => candidate.name === overwrite.role);
            if (!role) return null;
            return { id: role.id, allow: BigInt(overwrite.allow), deny: BigInt(overwrite.deny) };
          })
          .filter(Boolean),
        reason,
      });
      created.channels += 1;
    } catch {
      created.failed.push(`channel ${channel.name}`);
    }
  }

  return created;
}

module.exports = {
  BackupError,
  SUPPORTED_CHANNEL_TYPES,
  applyRestore,
  newBackupId,
  planRestore,
  serializeOverwrites,
  snapshotGuild,
};
