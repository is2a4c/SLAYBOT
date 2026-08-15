const { Collection, EmbedBuilder, GuildMember } = require("discord.js");
const { MODERATION, EMBED_COLORS } = require("@root/config");

// Utils
const { containsLink } = require("@helpers/Utils");
const { error } = require("@helpers/Logger");
const { sendModerationDm, sendWarningDm } = require("@src/services/moderationNotifications");
const { routeEvent } = require("@src/services/eventRouter/EventRouter");
const { muteRoleId, respectsRoleHierarchy, usesRoleMute, usesTimeoutMute } = require("@src/services/moderation/policy");
const { ensureGuildOverwrites } = require("@src/services/moderation/muteRole");
const { ensureScheduled: ensureWarningExpiryScheduled } = require("@src/services/moderation/warningExpiry");
const { grantTempRole, cancelTempRole } = require("@src/services/roles/TempRoles");

// Schemas
const { getSettings } = require("@schemas/Guild");
const { getMember } = require("@schemas/Member");
const { addModLogToDb } = require("@schemas/ModLog");

const DEFAULT_TIMEOUT_HOURS = 24; //hours

const memberInteract = (issuer, target) => {
  const { guild } = issuer;
  if (guild.ownerId === issuer.id) return true;
  if (guild.ownerId === target.id) return false;
  return issuer.roles.highest.position > target.roles.highest.position;
};

/**
 * Whether a human moderator may act on this target: always the owner,
 * never against the owner, and otherwise gated by role position unless the
 * server turned that check off. Passing no settings (or none found) keeps
 * the check always-on, matching the behaviour before this was configurable.
 *
 * The bot's own hierarchy check stays a plain `memberInteract(bot, target)`
 * everywhere below - Discord enforces that at the API level regardless of
 * what a server wants, so disabling it here would only turn a clear refusal
 * into a confusing failed API call.
 *
 * @param {import('discord.js').GuildMember} issuer
 * @param {import('discord.js').GuildMember} target
 * @param {object} [settings]
 */
const issuerCanModerate = (issuer, target, settings = null) => {
  const { guild } = issuer;
  if (guild.ownerId === issuer.id) return true;
  if (guild.ownerId === target.id) return false;
  if (!respectsRoleHierarchy(settings)) return true;
  return issuer.roles.highest.position > target.roles.highest.position;
};

/**
 * Send logs to the configured channel and stores in the database
 * @param {import('discord.js').GuildMember} issuer
 * @param {import('discord.js').GuildMember|import('discord.js').User} target
 * @param {string} reason
 * @param {string} type
 * @param {Object} data
 */
const logModeration = async (issuer, target, reason, type, data = {}) => {
  if (!type) return;
  const { guild } = issuer;
  const settings = await getSettings(guild);

  let logChannel;
  if (settings.modlog_channel) logChannel = guild.channels.cache.get(settings.modlog_channel);

  const embed = new EmbedBuilder().setColor(EMBED_COLORS.BOT_EMBED).setFooter({
    text: `By ${issuer.displayName} • ${issuer.id}`,
    iconURL: issuer.displayAvatarURL(),
  });

  const fields = [];
  switch (type.toUpperCase()) {
    case "PURGE":
      embed.setAuthor({ name: `Moderation - ${type}` });
      fields.push(
        { name: "Purge Type", value: data.purgeType, inline: true },
        { name: "Messages", value: data.deletedCount.toString(), inline: true },
        { name: "Channel", value: `#${data.channel.name} [${data.channel.id}]`, inline: false }
      );
      break;

    case "WARN":
      embed.setColor(MODERATION.EMBED_COLORS.WARN || "#FEE75C");
      break;

    case "TIMEOUT":
      embed.setColor(MODERATION.EMBED_COLORS.TIMEOUT);
      break;

    case "UNTIMEOUT":
      embed.setColor(MODERATION.EMBED_COLORS.UNTIMEOUT);
      break;

    case "KICK":
      embed.setColor(MODERATION.EMBED_COLORS.KICK);
      break;

    case "SOFTBAN":
      embed.setColor(MODERATION.EMBED_COLORS.SOFTBAN);
      break;

    case "BAN":
      embed.setColor(MODERATION.EMBED_COLORS.BAN);
      break;

    case "UNBAN":
      embed.setColor(MODERATION.EMBED_COLORS.UNBAN);
      break;

    case "VMUTE":
      embed.setColor(MODERATION.EMBED_COLORS.VMUTE);
      break;

    case "VUNMUTE":
      embed.setColor(MODERATION.EMBED_COLORS.VUNMUTE);
      break;

    case "DEAFEN":
      embed.setColor(MODERATION.EMBED_COLORS.DEAFEN);
      break;

    case "UNDEAFEN":
      embed.setColor(MODERATION.EMBED_COLORS.UNDEAFEN);
      break;

    case "DISCONNECT":
      embed.setColor(MODERATION.EMBED_COLORS.DISCONNECT);
      break;

    case "MOVE":
      embed.setColor(MODERATION.EMBED_COLORS.MOVE);
      break;
  }

  if (type.toUpperCase() !== "PURGE") {
    embed.setAuthor({ name: `Moderation - ${type}` }).setThumbnail(target.displayAvatarURL());

    if (target instanceof GuildMember) {
      fields.push({ name: "Member", value: `${target.displayName} [${target.id}]`, inline: false });
    } else {
      fields.push({ name: "User", value: `${target.globalName || target.username} [${target.id}]`, inline: false });
    }

    fields.push({ name: "Reason", value: reason || "No reason provided", inline: false });

    if (type.toUpperCase() === "TIMEOUT") {
      fields.push({
        name: "Expires",
        value: `<t:${Math.round(target.communicationDisabledUntilTimestamp / 1000)}:R>`,
        inline: true,
      });
    }
    if (type.toUpperCase() === "MOVE") {
      fields.push({ name: "Moved to", value: data.channel.name, inline: true });
    }
  }

  embed.setFields(fields);
  await addModLogToDb(issuer, target, reason, type.toUpperCase());
  if (logChannel) logChannel.safeSend({ embeds: [embed] });
};

module.exports = class ModUtils {
  /**
   * Get punishment history and warning info for a member
   * @param {import('discord.js').Guild} guild
   * @param {import('discord.js').GuildMember|import('discord.js').User} target
   */
  static async getPunishmentInfo(guild, target) {
    const memberDb = await getMember(guild.id, target.id);
    const settings = await getSettings(guild);
    const warningsLeft = settings.max_warn.limit - memberDb.warnings;
    const hasActiveTimeout = target instanceof GuildMember && target.communicationDisabledUntilTimestamp > Date.now();

    let nextAction = null;
    if (warningsLeft <= 1) {
      const actionMap = { TIMEOUT: "таймаут", KICK: "кик", BAN: "бан" };
      nextAction = actionMap[settings.max_warn.action] || settings.max_warn.action;
    }

    return {
      warnings: memberDb.warnings,
      maxWarn: settings.max_warn.limit,
      warningsLeft,
      hasActiveTimeout,
      nextAction,
      isLastWarning: warningsLeft === 1,
      isOverLimit: warningsLeft <= 0,
    };
  }

  /**
   * @param {import('discord.js').GuildMember} issuer
   * @param {import('discord.js').GuildMember} target
   * @param {object} [settings] when given, honours the server's own
   *   hierarchy-enforcement toggle; omit it for the always-on check
   */
  static canModerate(issuer, target, settings = null) {
    return issuerCanModerate(issuer, target, settings);
  }

  /**
   * @param {import('discord.js').GuildMember} issuer
   * @param {import('discord.js').GuildMember} target
   * @param {string} reason
   * @param {"TIMEOUT"|"KICK"|"SOFTBAN"|"BAN"} action
   */
  static async addModAction(issuer, target, reason, action) {
    switch (action) {
      case "TIMEOUT":
        return ModUtils.timeoutTarget(issuer, target, DEFAULT_TIMEOUT_HOURS * 60 * 60 * 1000, reason);

      case "KICK":
        return ModUtils.kickTarget(issuer, target, reason);

      case "SOFTBAN":
        return ModUtils.softbanTarget(issuer, target, reason);

      case "BAN":
        return ModUtils.banTarget(issuer, target, reason);
    }
  }
  /**
   * Delete the specified number of messages matching the type
   * @param {import('discord.js').GuildMember} issuer
   * @param {import('discord.js').BaseGuildTextChannel} channel
   * @param {"ATTACHMENT"|"BOT"|"LINK"|"TOKEN"|"USER"|"ALL"} type
   * @param {number} amount
   * @param {any} argument
   */
  static async purgeMessages(issuer, channel, type, amount, argument) {
    amount = Number.parseInt(amount, 10);
    if (!Number.isInteger(amount) || amount < 1) return "NO_MESSAGES";
    amount = Math.min(amount, 100);

    if (!channel.permissionsFor(issuer).has(["ManageMessages", "ReadMessageHistory"])) {
      return "MEMBER_PERM";
    }

    if (!channel.permissionsFor(issuer.guild.members.me).has(["ManageMessages", "ReadMessageHistory"])) {
      return "BOT_PERM";
    }

    const toDelete = new Collection();

    try {
      // A filtered purge has to look at more messages than it deletes, and the
      // fetch defaults to fifty — so asking to clear a hundred of somebody's
      // messages searched half the window it was given. A hundred is the most
      // Discord returns at once, and the most bulkDelete takes.
      const SEARCH_LIMIT = 100;
      const search = () => channel.messages.fetch({ limit: SEARCH_LIMIT, cache: false, force: true });

      let messages;
      switch (type) {
        case "ALL":
          messages = await channel.messages.fetch({ limit: amount, cache: false, force: true });
          break;
        case "BOT": {
          messages = await search();
          messages = messages.filter((message) => message.author.bot).first(amount);
          break;
        }
        case "LINK": {
          messages = await search();
          messages = messages.filter((message) => containsLink(message.content)).first(amount);
          break;
        }
        case "TOKEN": {
          messages = await search();
          messages = messages.filter((message) => message.content.includes(argument)).first(amount);
          break;
        }
        case "ATTACHMENT": {
          messages = await search();
          messages = messages.filter((message) => message.attachments.size > 0).first(amount);
          break;
        }
        case "USER": {
          messages = await search();
          messages = messages.filter((message) => message.author.id === argument).first(amount);
          break;
        }
      }

      for (const message of messages.values()) {
        if (toDelete.size >= amount) break;
        if (!message.deletable) continue;
        if (message.createdTimestamp < Date.now() - 1209600000) continue; // skip messages older than 14 days

        if (type === "ALL") {
          toDelete.set(message.id, message);
        } else if (type === "ATTACHMENT") {
          if (message.attachments.size > 0) {
            toDelete.set(message.id, message);
          }
        } else if (type === "BOT") {
          if (message.author.bot) {
            toDelete.set(message.id, message);
          }
        } else if (type === "LINK") {
          if (containsLink(message.content)) {
            toDelete.set(message.id, message);
          }
        } else if (type === "TOKEN") {
          if (message.content.includes(argument)) {
            toDelete.set(message.id, message);
          }
        } else if (type === "USER") {
          if (message.author.id === argument) {
            toDelete.set(message.id, message);
          }
        }
      }

      if (toDelete.size === 0) return "NO_MESSAGES";
      if (toDelete.size === 1 && toDelete.first().author.id === issuer.id) {
        await toDelete.first().delete();
        return "NO_MESSAGES";
      }

      const deletedMessages = await channel.bulkDelete(toDelete, true);
      await logModeration(issuer, "", "", "Purge", {
        purgeType: type,
        channel: channel,
        deletedCount: deletedMessages.size,
      });

      return deletedMessages.size;
    } catch (ex) {
      error("purgeMessages", ex);
      return "ERROR";
    }
  }

  /**
   * warns the target and logs to the database, channel
   * @param {import('discord.js').GuildMember} issuer
   * @param {import('discord.js').GuildMember} target
   * @param {string} reason
   */
  static async warnTarget(issuer, target, reason) {
    const settings = await getSettings(issuer.guild);
    if (!issuerCanModerate(issuer, target, settings)) return "MEMBER_PERM";
    if (!memberInteract(issuer.guild.members.me, target)) return "BOT_PERM";

    try {
      await logModeration(issuer, target, reason, "Warn");
      await routeEvent(issuer.guild, "WARN", { actor: issuer, target, reason, logger: issuer.client.logger });
      const memberDb = await getMember(issuer.guild.id, target.id);
      memberDb.warnings += 1;
      const warningCount = memberDb.warnings;
      const automaticAction = warningCount >= settings.max_warn.limit ? settings.max_warn.action : null;

      // check if max warnings are reached
      if (automaticAction) {
        await ModUtils.addModAction(issuer.guild.members.me, target, "Max warnings reached", settings.max_warn.action); // moderate
        memberDb.warnings = 0; // reset warnings
      }

      await memberDb.save();
      await ensureWarningExpiryScheduled(issuer.guild.id).catch((ex) =>
        error("warnTarget: could not arrange warning expiry", ex)
      );
      await sendWarningDm({
        target,
        settings,
        issuer,
        reason,
        warnings: warningCount,
        maxWarnings: settings.max_warn.limit,
        automaticAction,
      });
      return true;
    } catch (ex) {
      error("warnTarget", ex);
      return "ERROR";
    }
  }

  /**
   * Mutes the target and logs to the database, channel. Applies whichever
   * mechanism (or both) the server's own `mute_mode` selects - Discord's
   * timeout, the configured mute role, or both together.
   * @param {import('discord.js').GuildMember} issuer
   * @param {import('discord.js').GuildMember} target
   * @param {number} ms
   * @param {string} reason
   */
  static async timeoutTarget(issuer, target, ms, reason) {
    const settings = await getSettings(issuer.guild);
    if (!issuerCanModerate(issuer, target, settings)) return "MEMBER_PERM";
    if (!memberInteract(issuer.guild.members.me, target)) return "BOT_PERM";

    const usesTimeout = usesTimeoutMute(settings);
    const usesRole = usesRoleMute(settings);

    let role = null;
    if (usesRole) {
      const roleId = muteRoleId(settings);
      role = roleId ? issuer.guild.roles.cache.get(roleId) : null;
      if (!role) return "NO_MUTE_ROLE";
    }

    const timeoutActive = usesTimeout && target.communicationDisabledUntilTimestamp - Date.now() > 0;
    const roleActive = usesRole && target.roles.cache.has(role.id);
    const timeoutSatisfied = !usesTimeout || timeoutActive;
    const roleSatisfied = !usesRole || roleActive;
    if (timeoutSatisfied && roleSatisfied) return "ALREADY_TIMEOUT";

    try {
      if (usesTimeout && !timeoutActive) {
        await target.timeout(ms, reason);
      }
      if (usesRole && !roleActive) {
        await ensureGuildOverwrites(issuer.guild, role, settings);
        await grantTempRole({ member: target, role, durationMs: ms, reason, moderatorId: issuer.id });
      }

      await logModeration(issuer, target, reason, "Timeout");
      await routeEvent(issuer.guild, "TIMEOUT", { actor: issuer, target, reason, logger: issuer.client.logger });
      await sendModerationDm({ target, guild: issuer.guild, settings, action: "TIMEOUT", issuer, reason });
      return true;
    } catch (ex) {
      error("timeoutTarget", ex);
      return "ERROR";
    }
  }

  /**
   * Removes an active mute, by whichever mechanism actually put it there.
   * @param {import('discord.js').GuildMember} issuer
   * @param {import('discord.js').GuildMember} target
   * @param {string} reason
   */
  static async unTimeoutTarget(issuer, target, reason) {
    const settings = await getSettings(issuer.guild);
    if (!issuerCanModerate(issuer, target, settings)) return "MEMBER_PERM";
    if (!memberInteract(issuer.guild.members.me, target)) return "BOT_PERM";

    const usesTimeout = usesTimeoutMute(settings);
    const usesRole = usesRoleMute(settings);
    const roleId = usesRole ? muteRoleId(settings) : null;
    const role = roleId ? issuer.guild.roles.cache.get(roleId) : null;

    const timeoutActive = usesTimeout && target.communicationDisabledUntilTimestamp - Date.now() > 0;
    const roleActive = Boolean(usesRole && role && target.roles.cache.has(role.id));
    if (!timeoutActive && !roleActive) return "NOT_MUTED";

    try {
      if (timeoutActive) await target.timeout(null, reason);
      if (roleActive) {
        await target.roles.remove(role, reason || "Mute removed");
        await cancelTempRole({ guildId: issuer.guild.id, userId: target.id, roleId: role.id });
      }
      await logModeration(issuer, target, reason, "UnTimeout");
      return true;
    } catch (ex) {
      error("unTimeoutTarget", ex);
      return "ERROR";
    }
  }

  /**
   * kicks the target and logs to the database, channel
   * @param {import('discord.js').GuildMember} issuer
   * @param {import('discord.js').GuildMember} target
   * @param {string} reason
   */
  static async kickTarget(issuer, target, reason) {
    const settings = await getSettings(issuer.guild);
    if (!issuerCanModerate(issuer, target, settings)) return "MEMBER_PERM";
    if (!memberInteract(issuer.guild.members.me, target)) return "BOT_PERM";

    try {
      await target.kick(reason);
      await logModeration(issuer, target, reason, "Kick");
      await routeEvent(issuer.guild, "KICK", { actor: issuer, target, reason, logger: issuer.client.logger });
      await sendModerationDm({ target, guild: issuer.guild, settings, action: "KICK", issuer, reason });
      return true;
    } catch (ex) {
      error("kickTarget", ex);
      return "ERROR";
    }
  }

  /**
   * Softbans the target and logs to the database, channel
   * @param {import('discord.js').GuildMember} issuer
   * @param {import('discord.js').GuildMember} target
   * @param {string} reason
   */
  static async softbanTarget(issuer, target, reason) {
    const settings = await getSettings(issuer.guild);
    if (!issuerCanModerate(issuer, target, settings)) return "MEMBER_PERM";
    if (!memberInteract(issuer.guild.members.me, target)) return "BOT_PERM";

    try {
      await target.ban({ deleteMessageSeconds: 7 * 24 * 60 * 60, reason });
      await issuer.guild.members.unban(target.user);
      await logModeration(issuer, target, reason, "Softban");
      return true;
    } catch (ex) {
      error("softbanTarget", ex);
      return "ERROR";
    }
  }

  /**
   * Bans the target and logs to the database, channel
   * @param {import('discord.js').GuildMember} issuer
   * @param {import('discord.js').User} target
   * @param {string} reason
   */
  static async banTarget(issuer, target, reason) {
    const settings = await getSettings(issuer.guild);
    const targetMem = await issuer.guild.members.fetch(target.id).catch(() => {});

    if (targetMem && !issuerCanModerate(issuer, targetMem, settings)) return "MEMBER_PERM";
    if (targetMem && !memberInteract(issuer.guild.members.me, targetMem)) return "BOT_PERM";

    try {
      await issuer.guild.bans.create(target.id, { deleteMessageSeconds: 0, reason });
      await logModeration(issuer, target, reason, "Ban");
      await routeEvent(issuer.guild, "BAN", { actor: issuer, target, reason, logger: issuer.client.logger });
      await sendModerationDm({ target, guild: issuer.guild, settings, action: "BAN", issuer, reason });
      return true;
    } catch (ex) {
      error(`banTarget`, ex);
      return "ERROR";
    }
  }

  /**
   * Bans the target and logs to the database, channel
   * @param {import('discord.js').GuildMember} issuer
   * @param {import('discord.js').User} target
   * @param {string} reason
   */
  static async unBanTarget(issuer, target, reason) {
    try {
      await issuer.guild.bans.remove(target, reason);
      await logModeration(issuer, target, reason, "UnBan");
      return true;
    } catch (ex) {
      error(`unBanTarget`, ex);
      return "ERROR";
    }
  }

  /**
   * Voice mutes the target and logs to the database, channel
   * @param {import('discord.js').GuildMember} issuer
   * @param {import('discord.js').GuildMember} target
   * @param {string} reason
   */
  static async vMuteTarget(issuer, target, reason) {
    const settings = await getSettings(issuer.guild);
    if (!issuerCanModerate(issuer, target, settings)) return "MEMBER_PERM";
    if (!memberInteract(issuer.guild.members.me, target)) return "BOT_PERM";

    if (!target.voice.channel) return "NO_VOICE";
    if (target.voice.mute) return "ALREADY_MUTED";

    try {
      await target.voice.setMute(true, reason);
      await logModeration(issuer, target, reason, "Vmute");
      return true;
    } catch (ex) {
      error(`vMuteTarget`, ex);
      return "ERROR";
    }
  }

  /**
   * Voice unmutes the target and logs to the database, channel
   * @param {import('discord.js').GuildMember} issuer
   * @param {import('discord.js').GuildMember} target
   * @param {string} reason
   */
  static async vUnmuteTarget(issuer, target, reason) {
    const settings = await getSettings(issuer.guild);
    if (!issuerCanModerate(issuer, target, settings)) return "MEMBER_PERM";
    if (!memberInteract(issuer.guild.members.me, target)) return "BOT_PERM";

    if (!target.voice.channel) return "NO_VOICE";
    if (!target.voice.mute) return "NOT_MUTED";

    try {
      await target.voice.setMute(false, reason);
      await logModeration(issuer, target, reason, "Vunmute");
      return true;
    } catch (ex) {
      error(`vUnmuteTarget`, ex);
      return "ERROR";
    }
  }

  /**
   * Deafens the target and logs to the database, channel
   * @param {import('discord.js').GuildMember} issuer
   * @param {import('discord.js').GuildMember} target
   * @param {string} reason
   */
  static async deafenTarget(issuer, target, reason) {
    const settings = await getSettings(issuer.guild);
    if (!issuerCanModerate(issuer, target, settings)) return "MEMBER_PERM";
    if (!memberInteract(issuer.guild.members.me, target)) return "BOT_PERM";

    if (!target.voice.channel) return "NO_VOICE";
    if (target.voice.deaf) return "ALREADY_DEAFENED";

    try {
      await target.voice.setDeaf(true, reason);
      await logModeration(issuer, target, reason, "Deafen");
      return true;
    } catch (ex) {
      return `Failed to deafen ${target.user.globalName || target.user.username}`;
    }
  }

  /**
   * UnDeafens the target and logs to the database, channel
   * @param {import('discord.js').GuildMember} issuer
   * @param {import('discord.js').GuildMember} target
   * @param {string} reason
   */
  static async unDeafenTarget(issuer, target, reason) {
    const settings = await getSettings(issuer.guild);
    if (!issuerCanModerate(issuer, target, settings)) return "MEMBER_PERM";
    if (!memberInteract(issuer.guild.members.me, target)) return "BOT_PERM";

    if (!target.voice.channel) return "NO_VOICE";
    if (!target.voice.deaf) return "NOT_DEAFENED";

    try {
      await target.voice.setDeaf(false, reason);
      await logModeration(issuer, target, reason, "unDeafen");
      return true;
    } catch (ex) {
      error(`unDeafenTarget`, ex);
      return "ERROR";
    }
  }

  /**
   * Disconnects the target from voice channel and logs to the database, channel
   * @param {import('discord.js').GuildMember} issuer
   * @param {import('discord.js').GuildMember} target
   * @param {string} reason
   */
  static async disconnectTarget(issuer, target, reason) {
    const settings = await getSettings(issuer.guild);
    if (!issuerCanModerate(issuer, target, settings)) return "MEMBER_PERM";
    if (!memberInteract(issuer.guild.members.me, target)) return "BOT_PERM";

    if (!target.voice.channel) return "NO_VOICE";

    try {
      await target.voice.disconnect(reason);
      await logModeration(issuer, target, reason, "Disconnect");
      return true;
    } catch (ex) {
      error(`disconnectTarget`, ex);
      return "ERROR";
    }
  }

  /**
   * Moves the target to another voice channel and logs to the database, channel
   * @param {import('discord.js').GuildMember} issuer
   * @param {import('discord.js').GuildMember} target
   * @param {string} reason
   * @param {import('discord.js').VoiceChannel|import('discord.js').StageChannel} channel
   */
  static async moveTarget(issuer, target, reason, channel) {
    const settings = await getSettings(issuer.guild);
    if (!issuerCanModerate(issuer, target, settings)) return "MEMBER_PERM";
    if (!memberInteract(issuer.guild.members.me, target)) return "BOT_PERM";

    if (!target.voice?.channel) return "NO_VOICE";
    if (target.voice.channelId === channel.id) return "ALREADY_IN_CHANNEL";

    if (!channel.permissionsFor(target).has(["ViewChannel", "Connect"])) return "TARGET_PERM";

    try {
      await target.voice.setChannel(channel, reason);
      await logModeration(issuer, target, reason, "Move", { channel });
      return true;
    } catch (ex) {
      error(`moveTarget`, ex);
      return "ERROR";
    }
  }
};
