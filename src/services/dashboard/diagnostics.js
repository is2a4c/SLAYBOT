const { PermissionsBitField } = require("discord.js");

const REQUIRED_BOT_PERMISSIONS = [
  "ViewChannel",
  "SendMessages",
  "EmbedLinks",
  "ManageMessages",
  "ManageRoles",
  "ManageChannels",
  "KickMembers",
  "BanMembers",
  "ModerateMembers",
];

function check(id, status, message) {
  return { id, status, message };
}

/**
 * Runs a fixed set of read-only health checks against a guild's live Discord
 * state and its stored settings document. Kept free of DB/network access so it
 * stays easy to unit test - callers that need extra context (e.g. active Smart
 * Invites) fetch it themselves and pass it in via `extra`.
 *
 * @param {import('discord.js').Guild} guild
 * @param {object} settings - Guild.getSettings() result
 * @param {object} [extra]
 * @param {Array<{_id:string, channelId:string, status:string}>} [extra.smartInvites]
 * @returns {{checks: Array<{id:string,status:'pass'|'warn'|'fail',message:string}>, summary:{total:number,passed:number,warned:number,failed:number}}}
 */
function runDiagnostics(guild, settings, extra = {}) {
  const checks = [];
  const me = guild.members.me;

  if (!me) {
    checks.push(check("bot_member", "fail", "Бот не найден среди участников сервера."));
    return finalize(checks);
  }
  checks.push(check("bot_member", "pass", "Бот присутствует на сервере."));

  const missingPerms = REQUIRED_BOT_PERMISSIONS.filter((perm) => !me.permissions.has(PermissionsBitField.Flags[perm]));
  if (missingPerms.length > 0) {
    checks.push(check("bot_permissions", "fail", `Отсутствуют права: ${missingPerms.join(", ")}.`));
  } else {
    checks.push(check("bot_permissions", "pass", "У бота есть все необходимые базовые права."));
  }

  const botPosition = me.roles.highest.position;
  const higherRoles = guild.roles.cache.filter(
    (role) => role.id !== guild.id && !role.managed && role.position > botPosition
  ).size;
  if (higherRoles > 0) {
    checks.push(
      check(
        "role_position",
        "warn",
        `${higherRoles} роль(ей) расположены выше роли бота - участников с такими ролями бот не сможет модерировать.`
      )
    );
  } else {
    checks.push(check("role_position", "pass", "Роль бота расположена достаточно высоко для модерации."));
  }

  if (!settings.modlog_channel) {
    checks.push(check("modlog_channel", "warn", "Канал журнала модерации не настроен."));
  } else if (!guild.channels.cache.has(settings.modlog_channel)) {
    checks.push(check("modlog_channel", "fail", "Настроенный канал журнала модерации больше не существует."));
  } else {
    checks.push(check("modlog_channel", "pass", "Канал журнала модерации настроен и существует."));
  }

  if (settings.ticket?.log_channel) {
    checks.push(
      guild.channels.cache.has(settings.ticket.log_channel)
        ? check("ticket_log_channel", "pass", "Канал логов тикетов существует.")
        : check("ticket_log_channel", "fail", "Настроенный канал логов тикетов больше не существует.")
    );
  }

  const missingWebhookChannels = (settings.automod?.wh_channels || []).filter((id) => !guild.channels.cache.has(id));
  if (missingWebhookChannels.length > 0) {
    checks.push(
      check("automod_webhook_channels", "warn", `${missingWebhookChannels.length} канал(ов) для Automod webhook больше не существуют.`)
    );
  }

  const missingAutoroles = (settings.autorole || []).filter((id) => !guild.roles.cache.has(id));
  if (missingAutoroles.length > 0) {
    checks.push(check("autorole", "warn", `${missingAutoroles.length} авто-роль(ей) больше не существуют на сервере.`));
  }

  if (settings.welcome?.enabled && !guild.channels.cache.has(settings.welcome.channel)) {
    checks.push(check("welcome_channel", "fail", "Канал приветствий включён, но настроенный канал не найден."));
  }
  if (settings.farewell?.enabled && !guild.channels.cache.has(settings.farewell.channel)) {
    checks.push(check("farewell_channel", "fail", "Канал прощаний включён, но настроенный канал не найден."));
  }
  if (settings.suggestions?.enabled && !guild.channels.cache.has(settings.suggestions.channel_id)) {
    checks.push(check("suggestions_channel", "fail", "Предложения включены, но канал для них не найден."));
  }

  const smartInvites = extra.smartInvites || [];
  const brokenInvites = smartInvites.filter(
    (invite) => invite.status === "active" && !guild.channels.cache.has(invite.channelId)
  );
  if (brokenInvites.length > 0) {
    checks.push(
      check("smart_invites", "fail", `${brokenInvites.length} активная(ых) Smart Invite ведут на удалённый канал.`)
    );
  } else if (smartInvites.length > 0) {
    checks.push(check("smart_invites", "pass", "Все активные Smart Invites ссылаются на существующие каналы."));
  }

  return finalize(checks);
}

function finalize(checks) {
  const summary = { total: checks.length, passed: 0, warned: 0, failed: 0 };
  for (const item of checks) {
    if (item.status === "pass") summary.passed += 1;
    else if (item.status === "warn") summary.warned += 1;
    else summary.failed += 1;
  }
  return { checks, summary };
}

module.exports = { runDiagnostics, REQUIRED_BOT_PERMISSIONS };
