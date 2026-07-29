const { PermissionFlagsBits } = require("discord.js");
const SmartInvite = require("@schemas/SmartInvite");

const PREFIXES = ["SMART_INVITE_DELETE:", "SMART_INVITE_CANCEL:"];

async function handleButton(interaction) {
  const prefix = PREFIXES.find((value) => interaction.customId.startsWith(value));
  if (!prefix) return false;
  try {
    await handleKnownButton(interaction, prefix);
  } catch (error) {
    interaction.client.logger.error("smartInviteButton", error);
    const payload = {
      content: error?.safeMessage || "Не удалось обработать действие Smart Invite. Попробуйте позже.",
      components: [],
    };
    if (interaction.replied || interaction.deferred) await interaction.editReply(payload).catch(() => {});
    else await interaction.reply({ ...payload, ephemeral: true }).catch(() => {});
  }
  return true;
}

async function handleKnownButton(interaction, prefix) {
  const [recordId, requesterId] = interaction.customId.slice(prefix.length).split(":");
  if (interaction.user.id !== requesterId) {
    await interaction.reply({ content: "Подтвердить действие может только автор команды.", ephemeral: true });
    return;
  }
  if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({ content: "Требуется разрешение Manage Server.", ephemeral: true });
    return;
  }
  if (prefix === "SMART_INVITE_CANCEL:") {
    await interaction.update({ content: "Удаление отменено.", components: [] });
    return;
  }

  const record = await SmartInvite.findOne({ _id: recordId, guildId: interaction.guild.id });
  if (!record || record.status === "deleted") {
    await interaction.update({ content: "Ссылка уже удалена или не найдена.", components: [] });
    return;
  }
  if (!interaction.client.smartInvites) throw new Error("Smart Invites service is not running");
  await interaction.client.smartInvites.softDelete(interaction.guild.id, record.slug);
  await interaction.update({
    content: `Smart Invite \`${record.slug}\` удалён. Slug временно удерживается за сервером.`,
    components: [],
  });
}

module.exports = {
  handleButton,
};
