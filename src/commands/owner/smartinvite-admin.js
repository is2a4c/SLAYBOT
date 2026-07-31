const { ApplicationCommandOptionType, EmbedBuilder } = require("discord.js");
const { SmartInviteService } = require("@src/services/smart-invites/SmartInviteService");

const stringOption = (name, description) => ({
  name,
  description,
  type: ApplicationCommandOptionType.String,
  required: true,
});

module.exports = {
  name: "smartinvite-admin",
  description: "аварийное управление Smart Invites",
  category: "OWNER",
  command: { enabled: false },
  slashCommand: {
    enabled: true,
    ephemeral: true,
    options: [
      subcommand("disable", "отключить конкретную ссылку", stringOption("slug", "slug ссылки")),
      subcommand("status", "показать безопасный технический статус", stringOption("slug", "slug ссылки")),
      subcommand("unlock", "снять зависший lease", stringOption("slug", "slug ссылки")),
      subcommand("reserve", "зарезервировать slug", stringOption("slug", "slug")),
      subcommand("block-guild", "заблокировать guild ID", stringOption("guild-id", "Discord guild ID")),
      subcommand("unblock-guild", "разблокировать guild ID", stringOption("guild-id", "Discord guild ID")),
    ],
  },

  async interactionRun(interaction) {
    const service = interaction.client.smartInvites || new SmartInviteService(interaction.client);
    const action = interaction.options.getSubcommand();
    const slug = interaction.options.getString("slug");
    const guildId = interaction.options.getString("guild-id");
    let content;

    if (action === "disable") {
      const record = await service.disableLink(slug);
      content = `Ссылка \`${record.slug}\` отключена.`;
    } else if (action === "unlock") {
      const record = await service.forceUnlock(slug);
      content = `Lease ссылки \`${record.slug}\` снят.`;
    } else if (action === "reserve") {
      content = `Slug \`${await service.reserveSlug(slug)}\` зарезервирован.`;
    } else if (action === "block-guild" || action === "unblock-guild") {
      if (!/^\d{17,20}$/.test(guildId)) throw new Error("Некорректный Discord guild ID.");
      const blocked = action === "block-guild";
      await service.setGuildBlocked(guildId, blocked);
      content = `Guild \`${guildId}\` ${blocked ? "заблокирован" : "разблокирован"}.`;
    } else if (action === "status") {
      const found = await service.findBySlug(slug);
      if (!found) return interaction.safeFollowUp("Smart Invite не найден.");
      const record = found.record;
      const embed = new EmbedBuilder()
        .setColor(interaction.client.config.EMBED_COLORS.BOT_EMBED)
        .setTitle(`Smart Invite: ${record.slug}`)
        .addFields(
          { name: "Guild", value: record.guildId, inline: true },
          { name: "Channel", value: record.channelId, inline: true },
          { name: "Status", value: record.status, inline: true },
          { name: "Error", value: record.lastErrorCode || "нет", inline: true },
          {
            name: "Lease",
            value: record.regenerationLock ? `до ${record.regenerationLock.expiresAt.toISOString()}` : "нет",
            inline: true,
          },
          {
            name: "Counters",
            value: `clicks=${record.clickCount}, regenerations=${record.regenerationCount}, failures=${record.failedRedirectCount}`,
          }
        );
      return interaction.safeFollowUp({ embeds: [embed] });
    }
    return interaction.safeFollowUp(content);
  },
};

function subcommand(name, description, option) {
  return {
    name,
    description,
    type: ApplicationCommandOptionType.Subcommand,
    options: [option],
  };
}
