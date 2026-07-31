const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionFlagsBits } = require("discord.js");
const { EMBED_COLORS } = require("@root/config");
const { applyBranding, resolveBranding } = require("@helpers/Branding");
const { guildTranslator } = require("@src/i18n");
const { HOME_ID, PANELS, SYSTEM_ICONS, SYSTEM_IDS } = require("@src/services/panels/registry");

const HUB_PREFIX = "PANELHUB";
const OPEN = "open";

/**
 * The control hub: one button per system, each opening that system's own panel in
 * the same message.
 *
 * @param {(key: string, vars?: object) => string} t
 * @param {object} settings guild settings document
 * @param {import('discord.js').Client} [client]
 * @returns {{embeds: EmbedBuilder[], components: ActionRowBuilder[]}}
 */
function buildHub(t, settings, client) {
  const entries = SYSTEM_IDS.map((name) => ({
    name,
    icon: SYSTEM_ICONS[name] || "▫️",
    label: t(`panels.${name}.title`),
  }));

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLORS.BOT_EMBED)
    .setTitle(t("panels.hub.title"))
    .setDescription(
      [t("panels.hub.description"), "", entries.map((entry) => `${entry.icon} ${entry.label}`).join("\n")].join("\n")
    );

  applyBranding(embed, resolveBranding(settings, client), { force: true });

  const components = [];
  for (let index = 0; index < entries.length; index += 5) {
    components.push(
      new ActionRowBuilder().addComponents(
        entries
          .slice(index, index + 5)
          .map((entry) =>
            new ButtonBuilder()
              .setCustomId(`${HUB_PREFIX}:${OPEN}:${entry.name}`)
              .setEmoji(entry.icon)
              .setLabel(entry.label.slice(0, 40))
              .setStyle(ButtonStyle.Secondary)
          )
      )
    );
  }

  return { embeds: [embed], components };
}

module.exports = {
  HUB_PREFIX,
  buildHub,

  /**
   * @param {string} customId
   * @returns {boolean}
   */
  matches(customId) {
    return (
      String(customId).startsWith(`${HUB_PREFIX}:`) || SYSTEM_IDS.some((name) => PANELS[name].matches(String(customId)))
    );
  },

  /**
   * Route a click, a picked value or a submitted modal to whichever panel owns it.
   *
   * @param {import('discord.js').Interaction} interaction
   * @param {object} settings guild settings document
   * @returns {Promise<boolean>} whether the interaction belonged to a panel
   */
  async handle(interaction, settings) {
    const customId = interaction.customId;
    if (!this.matches(customId)) return false;

    const t = guildTranslator(settings, interaction.guild);

    // Settings are server-wide, so the panels stay behind Manage Server.
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply({ content: t("panels.common.forbidden"), ephemeral: true });
      return true;
    }

    if (customId === HOME_ID) {
      await interaction.update(buildHub(t, settings, interaction.client));
      return true;
    }

    if (customId.startsWith(`${HUB_PREFIX}:${OPEN}:`)) {
      const name = customId.slice(`${HUB_PREFIX}:${OPEN}:`.length);
      const panel = PANELS[name];
      if (!panel) return true;

      await interaction.update(panel.build(t, settings, interaction.client));
      return true;
    }

    for (const name of SYSTEM_IDS) {
      if (await PANELS[name].handle(interaction, settings, t)) return true;
    }

    return true;
  },
};
