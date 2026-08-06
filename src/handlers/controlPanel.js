const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
} = require("discord.js");
const { EMBED_COLORS } = require("@root/config");
const { applyBranding, resolveBranding } = require("@helpers/Branding");
const { guildTranslator } = require("@src/i18n");
const { HOME_ID, HUB_IDS, PANELS, SYSTEM_ICONS, SYSTEM_IDS } = require("@src/services/panels/registry");
const { guard, redraw, slowRedraw, warn } = require("@src/services/panels/reply");

const HUB_PREFIX = "PANELHUB";
const HUB_SELECT = `${HUB_PREFIX}~SEL:open`;
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
 * The control hub: the state of the whole server as two columns, and one menu
 * that opens any system's panel in the same message.
 *
 * The systems are split into what this server has running and what it has not, so
 * the state is read before anything is clicked — and the same mark is carried into
 * the menu, beside each system, so choosing one never means guessing. The order is
 * fixed either way: a system is always found in the same place.
 *
 * A menu rather than a wall of buttons: Discord allows five rows of five, which the
 * systems had already filled to the last seat, and a list stays readable as they
 * keep coming.
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
    HUB_IDS.map((name) => within(Promise.resolve(PANELS[name].isActive(settings, guild)).catch(() => false)))
  );

  const entries = HUB_IDS.map((name, index) => ({
    name,
    icon: SYSTEM_ICONS[name] || "▫️",
    label: t(`panels.${name}.title`),
    summary: t(`panels.${name}.description`),
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

  const components = [
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(HUB_SELECT)
        .setPlaceholder(t("panels.hub.pick"))
        .addOptions(
          entries.slice(0, 25).map((entry) => ({
            value: entry.name,
            emoji: entry.icon,
            label: entry.label.slice(0, 100),
            // What the system is for, and whether it is doing anything here, on
            // the same line as its name — the choice is made without opening it.
            description: `${entry.active ? "🟢" : "⚪"} ${entry.summary}`.slice(0, 100),
          }))
        )
    ),
  ];

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

/**
 * @param {string} customId
 * @returns {boolean}
 */
function matches(customId) {
  const text = String(customId);
  return (
    text.startsWith(`${HUB_PREFIX}:`) ||
    text.startsWith(`${HUB_PREFIX}~SEL:`) ||
    SYSTEM_IDS.some((name) => PANELS[name].matches(text))
  );
}

/**
 * Route a click, a picked value or a submitted modal to whichever panel owns it.
 *
 * @param {import('discord.js').Interaction} interaction
 * @param {object} settings guild settings document
 * @returns {Promise<boolean>} whether the interaction belonged to a panel
 */
async function handle(interaction, settings) {
  if (!matches(interaction.customId)) return false;

  const t = guildTranslator(settings, interaction.guild);

  return guard(interaction, () => route(interaction, settings, t), {
    message: t("panels.common.failed"),
    logger: interaction.client?.logger,
    label: "control panel",
  });
}

/**
 * @param {import('discord.js').Interaction} interaction
 * @param {object} settings guild settings document
 * @param {(key: string, vars?: object) => string} t
 */
async function route(interaction, settings, t) {
  const customId = interaction.customId;

  // Settings are server-wide, so the panels stay behind Manage Server.
  if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
    await warn(interaction, t("panels.common.forbidden"));
    return true;
  }

  if (customId === HOME_ID) {
    // The hub asks each list system how much it holds, so the click is
    // acknowledged before any of that starts.
    await slowRedraw(interaction, () => buildHub(t, settings, interaction.client, interaction.guild));
    return true;
  }

  // The menu opens a system; the button form is what hubs posted by older
  // versions still carry, and opens the same thing.
  if (customId === HUB_SELECT || customId.startsWith(`${HUB_PREFIX}:${OPEN}:`)) {
    const name = customId === HUB_SELECT ? interaction.values?.[0] : customId.slice(`${HUB_PREFIX}:${OPEN}:`.length);
    const panel = PANELS[name];
    // A hub posted by an older version can name a system this one does not have.
    if (!panel) {
      await slowRedraw(interaction, () => buildHub(t, settings, interaction.client, interaction.guild));
      return true;
    }

    // A settings panel is drawn from what is already in memory and answers in one
    // round-trip; a list panel has to read its entries first.
    if (panel.kind === "collection") {
      await slowRedraw(interaction, () => panel.open(t, settings, interaction));
      return true;
    }

    await redraw(interaction, await panel.open(t, settings, interaction));
    return true;
  }

  for (const name of SYSTEM_IDS) {
    if (await PANELS[name].handle(interaction, settings, t)) return true;
  }

  // Nothing owns it any more — the hub is the one screen that always exists.
  await slowRedraw(interaction, () => buildHub(t, settings, interaction.client, interaction.guild));
  return true;
}

module.exports = { HUB_PREFIX, buildHub, handle, matches };
