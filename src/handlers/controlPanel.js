const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionFlagsBits } = require("discord.js");
const { EMBED_COLORS } = require("@root/config");
const { applyBranding, resolveBranding } = require("@helpers/Branding");
const { guildTranslator } = require("@src/i18n");
const { HOME_ID, PANELS, SYSTEM_ICONS, SYSTEM_IDS } = require("@src/services/panels/registry");

const HUB_PREFIX = "PANELHUB";
const OPEN = "open";
const HUB_ICON = "🎛️";

// The catalogue of every command, which the command panel owns.
const COMMANDS_ID = "CMDP:home";

// How long the hub is willing to wait for a system to say whether it is running.
const STATE_TIMEOUT_MS = 1500;

/**
 * @param {Promise<boolean>} promise
 * @returns {Promise<boolean>} false if it did not answer in time
 */
function within(promise) {
  let timer;
  const late = new Promise((resolve) => {
    timer = setTimeout(() => resolve(false), STATE_TIMEOUT_MS);
    timer.unref?.();
  });

  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

/**
 * The control hub: one button per system, each opening that system's own panel in
 * the same message.
 *
 * The systems are split into what this server has running and what it has not, so
 * the state of the whole server is read before anything is clicked. Buttons carry
 * the same split in their colour, and stay in a fixed order either way — a system
 * is always found in the same place.
 *
 * @param {(key: string, vars?: object) => string} t
 * @param {object} settings guild settings document
 * @param {import('discord.js').Client} [client]
 * @returns {{embeds: EmbedBuilder[], components: ActionRowBuilder[]}}
 */
async function buildHub(t, settings, client, guild) {
  // Most systems answer from the settings document; the list ones have to count
  // what they hold, so the hub waits for all of them at once rather than in turn.
  // A slow database costs a wrong dot on one system, never the panel itself:
  // Discord gives three seconds to answer a click.
  const active = await Promise.all(
    SYSTEM_IDS.map((name) => within(Promise.resolve(PANELS[name].isActive(settings, guild)).catch(() => false)))
  );

  const entries = SYSTEM_IDS.map((name, index) => ({
    name,
    icon: SYSTEM_ICONS[name] || "▫️",
    label: t(`panels.${name}.title`),
    active: active[index],
  }));

  const column = (list) => (list.length ? list.map((entry) => `${entry.icon} ${entry.label}`).join("\n") : "—");
  const running = entries.filter((entry) => entry.active);
  const idle = entries.filter((entry) => !entry.active);

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLORS.BOT_EMBED)
    .setTitle(`${HUB_ICON} ${t("panels.hub.title")}`)
    .setDescription([t("panels.hub.description"), "", `-# ${t("panels.hub.hint")}`].join("\n"))
    .addFields(
      { name: `🟢 ${t("panels.hub.running")}`, value: column(running), inline: true },
      { name: `⚪ ${t("panels.hub.idle")}`, value: column(idle), inline: true }
    );

  applyBranding(embed, resolveBranding(settings, client), { force: true });

  const components = [];
  for (let index = 0; index < entries.length; index += 5) {
    components.push(
      new ActionRowBuilder().addComponents(
        entries.slice(index, index + 5).map((entry) =>
          new ButtonBuilder()
            .setCustomId(`${HUB_PREFIX}:${OPEN}:${entry.name}`)
            .setEmoji(entry.icon)
            .setLabel(entry.label.slice(0, 40))
            .setStyle(entry.active ? ButtonStyle.Success : ButtonStyle.Secondary)
        )
      )
    );
  }

  // Anything the bot can do that is not a stored setting lives one button away,
  // so the hub is the only thing anybody has to remember.
  components.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(COMMANDS_ID)
        .setEmoji("📚")
        .setLabel(t("commands.all"))
        .setStyle(ButtonStyle.Primary)
    )
  );

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
      await interaction.update(await buildHub(t, settings, interaction.client, interaction.guild));
      return true;
    }

    if (customId.startsWith(`${HUB_PREFIX}:${OPEN}:`)) {
      const name = customId.slice(`${HUB_PREFIX}:${OPEN}:`.length);
      const panel = PANELS[name];
      if (!panel) return true;

      await interaction.update(await panel.open(t, settings, interaction));
      return true;
    }

    for (const name of SYSTEM_IDS) {
      if (await PANELS[name].handle(interaction, settings, t)) return true;
    }

    return true;
  },
};
