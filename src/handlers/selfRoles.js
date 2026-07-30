const { getCachedPanel, getPanel } = require("@schemas/SelfRolePanel");
const { getSettings } = require("@schemas/Guild");
const {
  BUTTON_PREFIX,
  SELECT_PREFIX,
  buildPanelComponents,
  buildPanelEmbed,
  resolveRoleChanges,
} = require("@helpers/SelfRoles");

/**
 * @param {import('discord.js').Interaction} interaction
 * @param {object} panel
 * @param {string[]} selected
 */
async function applyChanges(interaction, panel, selected) {
  const member = interaction.member;

  if (panel.required_role && !member.roles.cache.has(panel.required_role)) {
    return interaction.reply({
      content: `You need <@&${panel.required_role}> to use this panel.`,
      ephemeral: true,
    });
  }

  const { add, remove, error } = resolveRoleChanges({
    panel,
    memberRoleIds: member.roles.cache.map((role) => role.id),
    selected,
  });

  if (error) return interaction.reply({ content: error, ephemeral: true });

  if (add.length === 0 && remove.length === 0) {
    return interaction.reply({ content: "Nothing to change.", ephemeral: true });
  }

  const me = interaction.guild.members.me;
  if (!me.permissions.has("ManageRoles")) {
    return interaction.reply({ content: "I am missing the `Manage Roles` permission.", ephemeral: true });
  }

  const blocked = [...add, ...remove].filter((roleId) => {
    const role = interaction.guild.roles.cache.get(roleId);
    return !role || role.managed || me.roles.highest.position <= role.position;
  });

  if (blocked.length > 0) {
    return interaction.reply({
      content: `I cannot manage ${blocked.map((id) => `<@&${id}>`).join(", ")}. Ask an admin to move my role higher.`,
      ephemeral: true,
    });
  }

  try {
    if (remove.length) await member.roles.remove(remove, "Self role panel");
    if (add.length) await member.roles.add(add, "Self role panel");
  } catch (ex) {
    interaction.client.logger?.error("selfRoles: failed to apply roles", ex);
    return interaction.reply({ content: "I could not update your roles. Try again later.", ephemeral: true });
  }

  const parts = [];
  if (add.length) parts.push(`Added ${add.map((id) => `<@&${id}>`).join(", ")}`);
  if (remove.length) parts.push(`Removed ${remove.map((id) => `<@&${id}>`).join(", ")}`);

  return interaction.reply({ content: parts.join("\n"), ephemeral: true });
}

/**
 * @param {import('discord.js').Interaction} interaction
 * @param {string} messageId
 */
async function loadPanel(interaction, messageId) {
  const cached = getCachedPanel(messageId);
  if (cached && cached.guild_id === interaction.guildId) return cached;
  return getPanel(interaction.guildId, messageId);
}

module.exports = {
  BUTTON_PREFIX,
  SELECT_PREFIX,

  /**
   * @param {import('discord.js').ButtonInteraction} interaction
   */
  async handleButton(interaction) {
    const [, messageId, roleId] = interaction.customId.split(":");
    const panel = await loadPanel(interaction, messageId);
    if (!panel) return interaction.reply({ content: "This panel no longer exists.", ephemeral: true });

    return applyChanges(interaction, panel, [roleId]);
  },

  /**
   * @param {import('discord.js').StringSelectMenuInteraction} interaction
   */
  async handleSelect(interaction) {
    const [, messageId] = interaction.customId.split(":");
    const panel = await loadPanel(interaction, messageId);
    if (!panel) return interaction.reply({ content: "This panel no longer exists.", ephemeral: true });

    return applyChanges(interaction, panel, interaction.values);
  },

  /**
   * Re-render a panel message after its configuration changed.
   * @param {import('discord.js').Client} client
   * @param {object} panel
   */
  async refreshPanel(client, panel) {
    const channel = await client.channels.fetch(panel.channel_id).catch(() => null);
    if (!channel?.isTextBased()) return false;

    const message = await channel.messages.fetch(panel.message_id).catch(() => null);
    if (!message) return false;

    const settings = channel.guild ? await getSettings(channel.guild).catch(() => null) : null;

    await message.edit({
      embeds: [buildPanelEmbed(panel, { settings, client })],
      components: buildPanelComponents(panel),
    });
    return true;
  },
};
