const { ApplicationCommandOptionType, EmbedBuilder } = require("discord.js");
const parseMilliseconds = require("enhanced-ms");
const prettyMilliseconds = require("pretty-ms");
const BlockedServer = require("@schemas/BlockedServer");
const { isValidServerId, getActiveBlock, removeExpiredBlocks } = require("@src/services/blockedServers");

const durationOption = {
  name: "duration",
  description: "Срок: 1h, 6h, 1d, 7d, 30d или forever",
  type: ApplicationCommandOptionType.String,
  required: false,
  choices: [
    { name: "1 час", value: "1h" },
    { name: "6 часов", value: "6h" },
    { name: "1 день", value: "1d" },
    { name: "7 дней", value: "7d" },
    { name: "30 дней", value: "30d" },
    { name: "Навсегда", value: "forever" },
  ],
};

module.exports = {
  name: "blockserver",
  description: "управление блокировкой Discord-серверов",
  category: "OWNER",
  command: {
    enabled: true,
    minArgsCount: 1,
    usage: "<block|unblock|list|status> [serverId] [duration] [reason]",
    subcommands: [
      { trigger: "block <serverId> [duration] [reason]", description: "заблокировать сервер" },
      { trigger: "unblock <serverId>", description: "разблокировать сервер" },
      { trigger: "list", description: "показать заблокированные серверы" },
      { trigger: "status <serverId>", description: "показать статус блокировки" },
    ],
  },
  slashCommand: {
    enabled: true,
    ephemeral: true,
    options: [
      subcommand("block", "заблокировать сервер", [
        stringOption("server-id", "Discord server ID"),
        durationOption,
        {
          name: "reason",
          description: "Причина блокировки",
          type: ApplicationCommandOptionType.String,
          required: false,
        },
      ]),
      subcommand("unblock", "разблокировать сервер", [stringOption("server-id", "Discord server ID")]),
      subcommand("list", "показать заблокированные серверы"),
      subcommand("status", "показать статус блокировки", [stringOption("server-id", "Discord server ID")]),
    ],
  },

  async messageRun(message, args) {
    const action = normalizeAction(args.shift());
    const serverId = args.shift();
    let durationInput = null;
    if (action === "block" && args.length && parseDuration(args[0])) {
      durationInput = args.shift();
    }
    const response = await executeAction({
      action,
      serverId,
      durationInput,
      reason: args.join(" "),
      user: message.author,
      client: message.client,
    });
    return message.safeReply(response);
  },

  async interactionRun(interaction) {
    const action = interaction.options.getSubcommand();
    const response = await executeAction({
      action,
      serverId: interaction.options.getString("server-id"),
      durationInput: interaction.options.getString("duration"),
      reason: interaction.options.getString("reason"),
      user: interaction.user,
      client: interaction.client,
    });
    return interaction.followUp(response);
  },
};

function subcommand(name, description, options) {
  return {
    name,
    description,
    type: ApplicationCommandOptionType.Subcommand,
    ...(options ? { options } : {}),
  };
}

function stringOption(name, description) {
  return {
    name,
    description,
    type: ApplicationCommandOptionType.String,
    required: true,
  };
}

function normalizeAction(action) {
  if (action === "add") return "block";
  if (action === "remove") return "unblock";
  if (action === "info") return "status";
  return action;
}

function parseDuration(value) {
  if (!value || value.toLowerCase() === "forever") {
    return { duration: 0, isPermanent: true };
  }

  const duration = parseMilliseconds(value);
  if (!Number.isFinite(duration) || duration <= 0) return null;
  return { duration, isPermanent: false };
}

async function executeAction({ action, serverId, durationInput, reason, user, client, model = BlockedServer }) {
  if (action === "list") return listBlocks(client, model);
  if (!["block", "unblock", "status"].includes(action)) {
    return "❌ Неизвестное действие. Используйте `block`, `unblock`, `list` или `status`.";
  }
  if (!isValidServerId(serverId)) return "❌ Укажите корректный Discord server ID.";

  if (action === "unblock") {
    const result = await model.deleteOne({ serverId });
    return result.deletedCount
      ? `✅ Сервер \`${serverId}\` разблокирован. Теперь бота снова можно туда добавить.`
      : `ℹ️ Сервер \`${serverId}\` не заблокирован.`;
  }

  const current = await getActiveBlock(serverId, { model });
  if (action === "status") return buildStatusResponse(serverId, current, client);
  if (current) return `❌ Сервер \`${serverId}\` уже заблокирован.`;

  const parsedDuration = parseDuration(durationInput);
  if (!parsedDuration) return "❌ Некорректный срок. Используйте, например, `1h`, `7d` или `forever`.";

  const blockedAt = new Date();
  const expiresAt = parsedDuration.isPermanent ? null : new Date(blockedAt.getTime() + parsedDuration.duration);
  const normalizedReason = normalizeReason(reason);
  await model.create({
    serverId,
    reason: normalizedReason,
    blockedBy: user.id,
    blockedAt,
    duration: parsedDuration.duration,
    expiresAt,
    isPermanent: parsedDuration.isPermanent,
  });

  const guild = client.guilds.cache.get(serverId);
  let leaveResult = "Бот не находился на этом сервере.";
  if (guild) {
    try {
      await guild.leave();
      leaveResult = `Бот покинул сервер \`${guild.name}\`.`;
    } catch (error) {
      client.logger.error("BlockedGuildLeave", error);
      leaveResult = "Блокировка сохранена, но выйти с сервера не удалось.";
    }
  }

  const until = parsedDuration.isPermanent
    ? "навсегда"
    : `<t:${Math.floor(expiresAt.getTime() / 1000)}:F> (<t:${Math.floor(expiresAt.getTime() / 1000)}:R>)`;
  return {
    embeds: [
      new EmbedBuilder()
        .setColor(client.config.EMBED_COLORS.ERROR)
        .setTitle("🚫 Сервер заблокирован")
        .addFields(
          { name: "Server ID", value: serverId, inline: true },
          { name: "Срок", value: until, inline: true },
          { name: "Причина", value: normalizedReason },
          { name: "Применение", value: leaveResult }
        )
        .setTimestamp(),
    ],
  };
}

async function listBlocks(client, model = BlockedServer) {
  await removeExpiredBlocks({ model });
  const blocks = await model.find({}).sort({ blockedAt: -1 }).limit(25);
  if (!blocks.length) return "📭 Заблокированных серверов нет.";

  const lines = blocks.map((block) => {
    const expires = block.isPermanent ? "навсегда" : `<t:${Math.floor(block.expiresAt.getTime() / 1000)}:R>`;
    return `• \`${block.serverId}\` — ${expires}\n  ${normalizeReason(block.reason)} · <@${block.blockedBy}>`;
  });
  const description = lines.reduce((result, line) => {
    const candidate = result ? `${result}\n\n${line}` : line;
    return candidate.length <= 4000 ? candidate : result;
  }, "");
  return {
    embeds: [
      new EmbedBuilder()
        .setColor(client.config.EMBED_COLORS.ERROR)
        .setTitle("🚫 Заблокированные серверы")
        .setDescription(description)
        .setFooter({ text: `Показано: ${blocks.length} (максимум 25)` }),
    ],
  };
}

function buildStatusResponse(serverId, block, client) {
  if (!block) return `✅ Сервер \`${serverId}\` не заблокирован.`;

  const duration = block.isPermanent
    ? "навсегда"
    : `${prettyMilliseconds(Math.max(0, block.expiresAt.getTime() - Date.now()), { verbose: true })} · <t:${Math.floor(
        block.expiresAt.getTime() / 1000
      )}:F>`;
  return {
    embeds: [
      new EmbedBuilder()
        .setColor(client.config.EMBED_COLORS.ERROR)
        .setTitle("🚫 Сервер заблокирован")
        .addFields(
          { name: "Server ID", value: serverId, inline: true },
          { name: "Срок", value: duration, inline: true },
          { name: "Причина", value: normalizeReason(block.reason) },
          { name: "Заблокировал", value: `<@${block.blockedBy}>`, inline: true }
        )
        .setTimestamp(block.blockedAt),
    ],
  };
}

function normalizeReason(reason) {
  const normalized = String(reason || "").trim();
  return normalized ? normalized.slice(0, 300) : "Причина не указана";
}

module.exports.parseDuration = parseDuration;
module.exports.executeAction = executeAction;
