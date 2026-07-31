const { ApplicationCommandOptionType, EmbedBuilder, PermissionFlagsBits } = require("discord.js");
const { OWNER_IDS, EMBED_COLORS } = require("@root/config");

const PERIODS = new Set([1, 7, 30]);

module.exports = {
  name: "telemetry",
  description: "shows private bot or server telemetry",
  category: "INFORMATION",
  botPermissions: ["EmbedLinks"],
  cooldown: 5,
  command: {
    enabled: true,
    aliases: ["metrics"],
    usage: "[server|global] [1d|7d|30d]",
  },
  slashCommand: {
    enabled: true,
    ephemeral: true,
    options: [
      {
        name: "scope",
        description: "server statistics or global bot statistics (owners only)",
        type: ApplicationCommandOptionType.String,
        required: false,
        choices: [
          { name: "This server", value: "server" },
          { name: "Whole bot (owner)", value: "global" },
        ],
      },
      {
        name: "period",
        description: "reporting period",
        type: ApplicationCommandOptionType.Integer,
        required: false,
        choices: [
          { name: "Today", value: 1 },
          { name: "7 days", value: 7 },
          { name: "30 days", value: 30 },
        ],
      },
    ],
  },

  async messageRun(message, args) {
    const requestedScope = args.find((arg) => ["server", "global"].includes(arg.toLowerCase()));
    const periodArg = args.find((arg) => /^\d+d$/i.test(arg));
    const period = periodArg ? Number.parseInt(periodArg, 10) : 7;
    const payload = await buildTelemetryReport({
      client: message.client,
      guild: message.guild,
      member: message.member,
      userId: message.author.id,
      requestedScope,
      period,
    });
    return message.safeReply(payload);
  },

  async interactionRun(interaction) {
    const payload = await buildTelemetryReport({
      client: interaction.client,
      guild: interaction.guild,
      member: interaction.member,
      userId: interaction.user.id,
      requestedScope: interaction.options.getString("scope"),
      period: interaction.options.getInteger("period") || 7,
    });
    return interaction.editReply(payload);
  },
};

function resolveAccess({ member, userId, requestedScope }) {
  const isOwner = OWNER_IDS.includes(userId);
  const canManageGuild = Boolean(member?.permissions?.has(PermissionFlagsBits.ManageGuild));
  const scope = requestedScope || (isOwner ? "global" : "server");

  if (!isOwner && !canManageGuild) {
    return { error: "Эта статистика доступна owner бота и администраторам сервера." };
  }
  if (scope === "global" && !isOwner) {
    return { error: "Глобальная телеметрия доступна только owner бота." };
  }
  return { scope, isOwner };
}

async function buildTelemetryReport({ client, guild, member, userId, requestedScope, period }) {
  const access = resolveAccess({ member, userId, requestedScope });
  if (access.error) return { content: access.error, embeds: [] };
  if (!client.telemetry) return { content: "Телеметрия на этом инстансе недоступна.", embeds: [] };

  const periodDays = PERIODS.has(Number(period)) ? Number(period) : 7;
  const scope = access.scope === "global" ? "global" : "guild";
  const summary = await client.telemetry.getSummary({
    scope,
    guildId: scope === "guild" ? guild.id : null,
    periodDays,
  });
  return {
    embeds: [renderTelemetryEmbed({ client, guild, summary })],
  };
}

function renderTelemetryEmbed({ client, guild, summary }) {
  const { counters, commandLatency } = summary;
  const successRate = counters.commands
    ? Math.round((counters.command_successes / counters.commands) * 1000) / 10
    : 100;
  const activeUsers = summary.activeUsers === null ? "н/д" : formatNumber(summary.activeUsers);
  const topCommands =
    Object.entries(summary.commandUsage)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count], index) => `${index + 1}. \`${name}\` — ${formatNumber(count)}`)
      .join("\n") || "Пока нет данных";
  const title =
    summary.scope === "global"
      ? `Телеметрия SLAYBOT · ${periodLabel(summary.periodDays)}`
      : `${guild.name} · ${periodLabel(summary.periodDays)}`;

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLORS.INFO || EMBED_COLORS.BOT_EMBED)
    .setAuthor({ name: "📊 Приватная телеметрия" })
    .setTitle(title)
    .addFields(
      {
        name: "Активность",
        value: [
          `Сообщения: **${formatNumber(counters.messages)}**`,
          `Активные пользователи: **${activeUsers}**`,
          `Interactions: **${formatNumber(counters.interactions)}**`,
          `Voice-входы: **${formatNumber(counters.voice_joins)}**`,
          `Voice-время: **${formatDuration(counters.voice_seconds)}**`,
        ].join("\n"),
        inline: true,
      },
      {
        name: "Команды",
        value: [
          `Всего: **${formatNumber(counters.commands)}**`,
          `Успешность: **${successRate}%**`,
          `Slash / prefix: **${formatNumber(counters.slash_commands)} / ${formatNumber(counters.prefix_commands)}**`,
          `Среднее время: **${formatNumber(commandLatency.averageMs)} мс**`,
          `Максимум: **${formatNumber(commandLatency.maxMs)} мс**`,
        ].join("\n"),
        inline: true,
      },
      {
        name: "Модерация и состав",
        value: [
          `AutoMod: **${formatNumber(counters.automod_actions)}**`,
          `Удалено сообщений: **${formatNumber(counters.automod_deletions)}**`,
          `Выдано страйков: **${formatNumber(counters.automod_strikes)}**`,
          `Вошли / вышли: **${formatNumber(counters.member_joins)} / ${formatNumber(counters.member_leaves)}**`,
        ].join("\n"),
        inline: true,
      },
      {
        name: "Надёжность",
        value: [
          `Ошибки клиента: **${formatNumber(counters.client_errors)}**`,
          `Предупреждения: **${formatNumber(counters.client_warnings)}**`,
          `Discord WS: **${formatNumber(Math.max(0, Math.round(client.ws?.ping || 0)))} мс**`,
          `Uptime: **${formatDuration(Math.floor(process.uptime()))}**`,
        ].join("\n"),
        inline: true,
      },
      {
        name: "Топ команд",
        value: topCommands,
        inline: false,
      }
    )
    .setFooter({
      text:
        summary.scope === "global"
          ? `${client.guilds.cache.size} серверов · только owner`
          : `Только администраторам сервера · без содержимого сообщений`,
    })
    .setTimestamp();

  if (summary.scope === "global") {
    embed.addFields({
      name: "Сеть",
      value: [
        `Серверы сейчас: **${formatNumber(client.guilds.cache.size)}**`,
        `Добавления / удаления: **${formatNumber(counters.guild_joins)} / ${formatNumber(counters.guild_leaves)}**`,
      ].join("\n"),
      inline: true,
    });
  }

  return embed;
}

function periodLabel(days) {
  if (days === 1) return "сегодня";
  return `${days} дней`;
}

function formatNumber(value) {
  return new Intl.NumberFormat("ru-RU").format(Number(value) || 0);
}

function formatDuration(totalSeconds) {
  const seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days) return `${days}д ${hours}ч`;
  if (hours) return `${hours}ч ${minutes}м`;
  if (minutes) return `${minutes}м`;
  return `${seconds}с`;
}

module.exports.buildTelemetryReport = buildTelemetryReport;
module.exports.renderTelemetryEmbed = renderTelemetryEmbed;
module.exports.resolveAccess = resolveAccess;
