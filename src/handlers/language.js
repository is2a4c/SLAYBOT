const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionFlagsBits } = require("discord.js");
const { EMBED_COLORS } = require("@root/config");
const { LOCALE_LABELS, guildTranslator, interactionTranslator, resolveLocale } = require("@src/i18n");
const { applyBranding, resolveBranding } = require("@helpers/Branding");

const BUTTON_PREFIX = "LANG";

/**
 * The language picker: one button per language plus "follow the server".
 *
 * @param {(key: string, vars?: object) => string} t
 * @param {object} settings guild settings document
 * @param {import('discord.js').Guild} guild
 * @returns {{embeds: EmbedBuilder[], components: ActionRowBuilder[]}}
 */
function buildPanel(t, settings, guild) {
  const current = settings?.language || null;
  const automatic = resolveLocale({ guildLocale: guild?.preferredLocale });

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLORS.BOT_EMBED)
    .setTitle(t("language.title"))
    .setDescription(
      [
        t("language.description"),
        "",
        t("language.current", {
          value: current ? LOCALE_LABELS[current] : t("language.autoValue", { value: LOCALE_LABELS[automatic] }),
        }),
      ].join("\n")
    );

  applyBranding(embed, resolveBranding(settings, guild?.client), { force: true });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${BUTTON_PREFIX}:auto`)
      .setLabel(t("language.auto"))
      .setEmoji("🌐")
      .setStyle(current === null ? ButtonStyle.Success : ButtonStyle.Secondary),
    ...Object.entries(LOCALE_LABELS).map(([code, label]) =>
      new ButtonBuilder()
        .setCustomId(`${BUTTON_PREFIX}:${code}`)
        .setLabel(label)
        .setStyle(current === code ? ButtonStyle.Success : ButtonStyle.Secondary)
    )
  );

  return { embeds: [embed], components: [row] };
}

module.exports = {
  BUTTON_PREFIX,
  buildPanel,

  /**
   * @param {import('discord.js').ButtonInteraction} interaction
   * @param {object} settings guild settings document
   */
  async handleButton(interaction, settings) {
    const t = interactionTranslator(interaction, settings);

    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ content: t("language.forbidden"), ephemeral: true });
    }

    const choice = interaction.customId.slice(BUTTON_PREFIX.length + 1);
    settings.language = choice === "auto" ? null : choice;
    await settings.save();

    // Redrawn in the language the server now speaks, so the change is visible at once.
    return interaction.update(buildPanel(guildTranslator(settings, interaction.guild), settings, interaction.guild));
  },
};
