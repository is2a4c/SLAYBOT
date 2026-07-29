const {
  ActionRowBuilder,
  ApplicationCommandOptionType,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
} = require("discord.js");
const { SmartInviteService } = require("@src/services/smart-invites/SmartInviteService");
const SmartInviteError = require("@src/services/smart-invites/SmartInviteError");
const { DEFAULT_DESCRIPTION } = require("@src/services/smart-invites/constants");
const { publicInviteURL } = require("@src/services/smart-invites/config");

function stringOption(name, description, required = true, maxLength) {
  return {
    name,
    description,
    type: ApplicationCommandOptionType.String,
    required,
    ...(maxLength ? { maxLength } : {}),
  };
}

function getService(client) {
  if (client.smartInvites) return client.smartInvites;
  if (client.config.SMART_INVITES.enabled) {
    throw new SmartInviteError("SERVICE_UNAVAILABLE", "Smart Invites временно недоступны: HTTP-сервис не запущен.");
  }
  return new SmartInviteService(client);
}

/**
 * @type {import("@structures/Command")}
 */
module.exports = {
  name: "smart-invite",
  description: "управление постоянными ссылками SLAYBOT Smart Invites",
  category: "INVITE",
  userPermissions: ["ManageGuild"],
  cooldown: require("@root/config").SMART_INVITES?.commandCooldownSeconds || 5,
  command: { enabled: false },
  slashCommand: {
    enabled: true,
    ephemeral: true,
    options: [
      {
        name: "create",
        description: "создать постоянную ссылку",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          stringOption("slug", "адрес ссылки, например my-server"),
          {
            name: "channel",
            description: "канал внутреннего Discord-приглашения",
            type: ApplicationCommandOptionType.Channel,
            required: true,
            channelTypes: [
              ChannelType.GuildText,
              ChannelType.GuildAnnouncement,
              ChannelType.GuildVoice,
              ChannelType.GuildStageVoice,
            ],
          },
          stringOption("description", "публичное описание (до 200 символов)", false, 200),
        ],
      },
      {
        name: "list",
        description: "показать ссылки этого сервера",
        type: ApplicationCommandOptionType.Subcommand,
      },
      {
        name: "info",
        description: "показать подробности ссылки",
        type: ApplicationCommandOptionType.Subcommand,
        options: [stringOption("slug", "slug ссылки")],
      },
      {
        name: "refresh",
        description: "принудительно заменить внутренний Discord-инвайт",
        type: ApplicationCommandOptionType.Subcommand,
        options: [stringOption("slug", "slug ссылки")],
      },
      {
        name: "set-channel",
        description: "изменить канал и заменить внутренний инвайт",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          stringOption("slug", "slug ссылки"),
          {
            name: "channel",
            description: "новый канал",
            type: ApplicationCommandOptionType.Channel,
            required: true,
            channelTypes: [
              ChannelType.GuildText,
              ChannelType.GuildAnnouncement,
              ChannelType.GuildVoice,
              ChannelType.GuildStageVoice,
            ],
          },
        ],
      },
      {
        name: "set-description",
        description: "изменить публичное описание",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          stringOption("slug", "slug ссылки"),
          stringOption("description", "новое описание (до 200 символов)", true, 200),
        ],
      },
      {
        name: "remove-description",
        description: "вернуть стандартное описание",
        type: ApplicationCommandOptionType.Subcommand,
        options: [stringOption("slug", "slug ссылки")],
      },
      {
        name: "rename",
        description: "переименовать ссылку, оставив временный alias",
        type: ApplicationCommandOptionType.Subcommand,
        options: [stringOption("slug", "текущий slug"), stringOption("new-slug", "новый slug")],
      },
      {
        name: "delete",
        description: "отключить и удалить ссылку с подтверждением",
        type: ApplicationCommandOptionType.Subcommand,
        options: [stringOption("slug", "slug ссылки")],
      },
    ],
  },

  async interactionRun(interaction) {
    const service = getService(interaction.client);
    service.assertEnabled();
    const subcommand = interaction.options.getSubcommand();
    const slug = interaction.options.getString("slug");
    let record;

    if (subcommand === "create") {
      const channel = interaction.options.getChannel("channel");
      record = await service.create({
        guildId: interaction.guild.id,
        channelId: channel.id,
        slug,
        description: interaction.options.getString("description"),
        actor: interaction.user,
      });
      return interaction.followUp({
        embeds: [recordEmbed(interaction, service, record, "Smart Invite создан")],
      });
    }

    if (subcommand === "list") {
      const records = await service.listForGuild(interaction.guild.id);
      const description =
        records.length === 0
          ? "На этом сервере ещё нет Smart Invites."
          : records
              .map((item) => {
                const text = item.description || DEFAULT_DESCRIPTION;
                const shortened = text.length > 70 ? `${text.slice(0, 67)}…` : text;
                return [
                  `**${item.slug}** — ${publicInviteURL(service.config, item.slug)}`,
                  `${shortened}`,
                  `Канал: <#${item.channelId}> • статус: \`${item.status}\``,
                  `HTTP-переходы: ${item.clickCount} • восстановления: ${item.regenerationCount}`,
                  `Создано: ${formatDate(item.createdAt)} • проверено: ${formatDate(item.lastSuccessfulValidationAt)}`,
                ].join("\n");
              })
              .join("\n\n");
      return interaction.followUp({
        embeds: [
          new EmbedBuilder()
            .setColor(interaction.client.config.EMBED_COLORS.BOT_EMBED)
            .setTitle("Smart Invites этого сервера")
            .setDescription(description.slice(0, 4096)),
        ],
      });
    }

    if (subcommand === "info") {
      record = (await service.findOwned(interaction.guild.id, slug)).record;
      return interaction.followUp({
        embeds: [recordEmbed(interaction, service, record, "Информация о Smart Invite", true)],
      });
    }

    if (subcommand === "refresh") {
      record = await service.refresh(interaction.guild.id, slug, interaction.user);
      return interaction.followUp({
        embeds: [recordEmbed(interaction, service, record, "Внутренний инвайт обновлён")],
      });
    }

    if (subcommand === "set-channel") {
      const channel = interaction.options.getChannel("channel");
      record = await service.setChannel(interaction.guild.id, slug, channel.id, interaction.user);
      return interaction.followUp({
        embeds: [recordEmbed(interaction, service, record, "Канал Smart Invite изменён")],
      });
    }

    if (subcommand === "set-description") {
      record = await service.setDescription(interaction.guild.id, slug, interaction.options.getString("description"));
      return interaction.followUp({
        embeds: [recordEmbed(interaction, service, record, "Описание обновлено")],
      });
    }

    if (subcommand === "remove-description") {
      record = await service.setDescription(interaction.guild.id, slug, null);
      return interaction.followUp({
        embeds: [recordEmbed(interaction, service, record, "Используется стандартное описание")],
      });
    }

    if (subcommand === "rename") {
      record = await service.rename(interaction.guild.id, slug, interaction.options.getString("new-slug"));
      return interaction.followUp({
        embeds: [recordEmbed(interaction, service, record, "Smart Invite переименован")],
      });
    }

    if (subcommand === "delete") {
      record = (await service.findOwned(interaction.guild.id, slug)).record;
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`SMART_INVITE_DELETE:${record._id}:${interaction.user.id}`)
          .setLabel("Удалить ссылку")
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(`SMART_INVITE_CANCEL:${record._id}:${interaction.user.id}`)
          .setLabel("Отмена")
          .setStyle(ButtonStyle.Secondary)
      );
      return interaction.followUp({
        content: `Подтвердите удаление \`${record.slug}\`. Адрес будет удерживаться за сервером до ${formatDate(
          new Date(Date.now() + service.config.deletedSlugRetentionMs)
        )}.`,
        components: [row],
      });
    }
  },
};

function recordEmbed(interaction, service, record, title, detailed = false) {
  const description = record.description || DEFAULT_DESCRIPTION;
  const fields = [
    { name: "Публичный адрес", value: publicInviteURL(service.config, record.slug) },
    { name: "Описание", value: description },
    { name: "Канал", value: `<#${record.channelId}>`, inline: true },
    { name: "Статус", value: record.status, inline: true },
  ];
  if (detailed) {
    fields.push(
      {
        name: "Статистика",
        value: [
          `HTTP-переходы: ${record.clickCount}`,
          `Preview: ${record.successfulPreviewCount}`,
          `Перенаправления: ${record.successfulRedirectCount}`,
          `Нажатия кнопки: ${record.joinButtonClickCount}`,
          `Ошибки: ${record.failedRedirectCount}`,
        ].join("\n"),
      },
      {
        name: "Восстановление",
        value: `Автоматических: ${record.regenerationCount}\nРучных: ${record.manualRefreshCount}\nПоследнее: ${formatDate(
          record.lastRegeneratedAt
        )}`,
        inline: true,
      },
      {
        name: "Даты",
        value: `Создано: ${formatDate(record.createdAt)}\nПроверено: ${formatDate(record.lastSuccessfulValidationAt)}`,
        inline: true,
      }
    );
    if (record.lastErrorCode) {
      fields.push({ name: "Последняя безопасная ошибка", value: `\`${record.lastErrorCode}\`` });
    }
  }
  return new EmbedBuilder()
    .setColor(interaction.client.config.EMBED_COLORS.BOT_EMBED)
    .setTitle(title)
    .addFields(fields)
    .setFooter({ text: "HTTP-переходы не являются количеством вступивших пользователей." });
}

function formatDate(value) {
  if (!value) return "ещё нет";
  return `<t:${Math.floor(new Date(value).getTime() / 1000)}:f>`;
}
