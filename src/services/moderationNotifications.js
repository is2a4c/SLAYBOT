const { EmbedBuilder } = require("discord.js");
const { MODERATION } = require("@root/config");

const ACTION_LABELS = {
  TIMEOUT: "таймаут",
  KICK: "кик",
  BAN: "бан",
};

const ACTION_SETTINGS = {
  BAN: "dm_on_ban",
  KICK: "dm_on_kick",
  TIMEOUT: "dm_on_mute",
};

function truncate(value, maxLength) {
  const text = String(value || "Причина не указана");
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}…`;
}

/**
 * Build the private notification sent to a warned member.
 *
 * @param {Object} input
 * @param {import('discord.js').Guild} input.guild
 * @param {import('discord.js').GuildMember} input.issuer
 * @param {string} input.reason
 * @param {number} input.warnings
 * @param {number} input.maxWarnings
 * @param {string|null} input.automaticAction
 */
function buildWarningDm({ guild, issuer, reason, warnings, maxWarnings, automaticAction = null }) {
  const fields = [
    { name: "Причина", value: truncate(reason, 1024) },
    { name: "Модератор", value: `${issuer.displayName} (${issuer.id})` },
    { name: "Предупреждения", value: `${warnings}/${maxWarnings}` },
  ];

  if (automaticAction) {
    fields.push({
      name: "Автоматическое наказание",
      value: ACTION_LABELS[automaticAction] || automaticAction,
    });
  }

  return {
    embeds: [
      new EmbedBuilder()
        .setColor(MODERATION.EMBED_COLORS.WARN || "#FEE75C")
        .setAuthor({ name: "Предупреждение модерации" })
        .setThumbnail(guild.iconURL?.() || null)
        .setDescription(`Вам выдано предупреждение на сервере **${truncate(guild.name, 200)}**.`)
        .addFields(fields)
        .setFooter({ text: `Сервер: ${guild.id}` })
        .setTimestamp(),
    ],
  };
}

/**
 * DM delivery must never roll back an otherwise successful moderation action:
 * users are allowed to close their private messages.
 *
 * @param {Object} input
 * @param {import('discord.js').GuildMember} input.target
 * @param {Object} input.settings
 * @returns {Promise<boolean>} whether Discord accepted the DM
 */
async function sendWarningDm({ target, settings, ...details }) {
  if (settings.control_center?.notifications?.dm_on_warn === false) return false;

  try {
    await target.send(buildWarningDm({ ...details, guild: target.guild }));
    return true;
  } catch (ex) {
    target.client?.logger?.debug?.(`Failed to send warning DM to ${target.id}`, ex);
    return false;
  }
}

function buildModerationDm({ guild, issuer, target, reason, action }) {
  const label = ACTION_LABELS[action] || action.toLowerCase();
  return {
    embeds: [
      new EmbedBuilder()
        .setColor(MODERATION.EMBED_COLORS[action] || "#ED4245")
        .setAuthor({ name: `Модерация · ${label}` })
        .setThumbnail(guild.iconURL?.() || null)
        .setDescription(`К вам применено действие **${label}** на сервере **${truncate(guild.name, 200)}**.`)
        .addFields(
          { name: "Причина", value: truncate(reason, 1024) },
          { name: "Модератор", value: `${issuer.displayName} (${issuer.id})` },
          { name: "Пользователь", value: `${target.globalName || target.username || target.id} (${target.id})` }
        )
        .setFooter({ text: `Сервер: ${guild.id}` })
        .setTimestamp(),
    ],
  };
}

async function sendModerationDm({ target, guild, settings, action, issuer, reason }) {
  const normalized = String(action || "").toUpperCase();
  const setting = ACTION_SETTINGS[normalized];
  if (!setting || settings.control_center?.notifications?.[setting] === false) return false;
  const user = target.user || target;
  try {
    await user.send(buildModerationDm({ target: user, guild, settings, action: normalized, issuer, reason }));
    return true;
  } catch (ex) {
    guild.client?.logger?.debug?.(`Failed to send ${normalized} DM to ${user.id}`, ex);
    return false;
  }
}

module.exports = { buildModerationDm, buildWarningDm, sendModerationDm, sendWarningDm };
