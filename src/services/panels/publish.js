const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require("discord.js");
const { EMBED_COLORS } = require("@root/config");
const { applyBranding, resolveBranding } = require("@helpers/Branding");

/**
 * Posting the public-facing panels a settings panel can hand out.
 *
 * These run after a channel has been picked in the settings panel: the message
 * members actually click is placed for them, replacing whatever was there before
 * so a server never accumulates stale panels.
 */

/**
 * @param {import('discord.js').Guild} guild
 * @param {string} channelId
 * @param {string} messageId
 */
async function removePrevious(guild, channelId, messageId) {
  if (!channelId || !messageId) return;

  const channel = guild.channels.cache.get(channelId);
  await channel?.messages
    ?.fetch(messageId)
    .then((message) => message.delete())
    .catch(() => {});
}

/**
 * @param {import('discord.js').Interaction} interaction
 * @param {string} channelId
 * @returns {import('discord.js').TextBasedChannel|null}
 */
function resolveChannel(interaction, channelId) {
  const channel = channelId ? interaction.guild.channels.cache.get(channelId) : null;
  return channel?.isTextBased?.() ? channel : null;
}

module.exports = {
  removePrevious,

  /**
   * The "open a ticket" message.
   *
   * @param {import('discord.js').Interaction} interaction
   * @param {object} settings guild settings document
   * @param {(key: string, vars?: object) => string} t
   */
  async ticketPanel(interaction, settings, t) {
    const config = settings.ticket;
    const channel = resolveChannel(interaction, config.panel_channel_id);
    if (!channel) return;

    await removePrevious(interaction.guild, config.panel_channel_id, config.panel_message_id);

    const embed = new EmbedBuilder()
      .setColor(EMBED_COLORS.BOT_EMBED)
      .setAuthor({ name: config.panel_title || t("panels.ticket.title") })
      .setDescription(config.panel_description || "");

    applyBranding(embed, resolveBranding(settings, interaction.client), { force: true });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("TICKET_CREATE").setLabel(t("panels.ticket.open")).setStyle(ButtonStyle.Success)
    );

    const message = await channel.send({ embeds: [embed], components: [row] }).catch(() => null);
    if (!message) return;

    config.panel_message_id = message.id;
    await settings.save();
  },

  /**
   * The verify button members press to get in.
   *
   * @param {import('discord.js').Interaction} interaction
   * @param {object} settings guild settings document
   */
  async verificationPanel(interaction, settings) {
    const config = settings.verification;
    const channel = resolveChannel(interaction, config.channel_id);
    if (!channel) return;

    await removePrevious(interaction.guild, config.channel_id, config.message_id);

    const { verificationHandler } = require("@src/handlers");
    const panel = verificationHandler.buildPanel(config, { settings, client: interaction.client });

    const message = await channel.send(panel).catch(() => null);
    if (!message) return;

    config.message_id = message.id;
    await settings.save();
  },

  /**
   * The temporary-voice control panel.
   *
   * @param {import('discord.js').Interaction} interaction
   * @param {object} settings guild settings document
   */
  async tempVoicePanel(interaction, settings) {
    const channel = resolveChannel(interaction, settings.temp_voice.panel_channel_id);
    if (!channel) return;

    const { tempVoiceHandler } = require("@src/handlers");
    await tempVoiceHandler.postPanel(channel, settings).catch(() => {});
  },
};
