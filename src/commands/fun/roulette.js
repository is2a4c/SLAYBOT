const { EmbedBuilder } = require("discord.js");
const { EMBED_COLORS } = require("@root/config");
const { TIMEOUT_MS, rouletteEnabled, spinsChamber } = require("@src/services/fun/roulette");

const SPIN_DELAY_MS = 1800;

/**
 * @type {import("@structures/Command")}
 */
module.exports = {
  name: "roulette",
  description: "spin the chamber - one in six",
  cooldown: 15,
  category: "FUN",
  botPermissions: ["EmbedLinks"],
  command: {
    enabled: true,
  },
  slashCommand: {
    enabled: true,
    options: [],
  },

  async messageRun(message, args, data) {
    if (!rouletteEnabled(data.settings)) return message.safeReply(disabledEmbed());

    const sent = await message.channel.send({ embeds: [spinningEmbed(message.member)] }).catch(() => null);
    await new Promise((resolve) => setTimeout(resolve, SPIN_DELAY_MS));
    const result = await resolveSpin(message.member);
    if (sent) await sent.edit({ embeds: [result] }).catch(() => {});
    else await message.safeReply({ embeds: [result] });
  },

  async interactionRun(interaction, data) {
    if (!rouletteEnabled(data.settings)) return interaction.safeFollowUp(disabledEmbed());

    await interaction.safeFollowUp({ embeds: [spinningEmbed(interaction.member)] });
    await new Promise((resolve) => setTimeout(resolve, SPIN_DELAY_MS));
    const result = await resolveSpin(interaction.member);
    await interaction.editReply({ embeds: [result] }).catch(() => {});
  },
};

function disabledEmbed() {
  return {
    embeds: [new EmbedBuilder().setColor(EMBED_COLORS.ERROR).setDescription("Roulette is turned off on this server.")],
  };
}

/**
 * @param {import('discord.js').GuildMember} member
 */
function spinningEmbed(member) {
  return new EmbedBuilder()
    .setColor(EMBED_COLORS.WARNING)
    .setDescription(`${member.toString()} spins the chamber... 🔫`);
}

/**
 * @param {import('discord.js').GuildMember} member
 * @returns {Promise<EmbedBuilder>}
 */
async function resolveSpin(member) {
  if (!spinsChamber()) {
    return new EmbedBuilder()
      .setColor(EMBED_COLORS.OK)
      .setDescription(`*click* — ${member.toString()} survives. Empty chamber.`);
  }

  if (!member.moderatable) {
    return new EmbedBuilder()
      .setColor(EMBED_COLORS.OK)
      .setDescription(`💥 The chamber was loaded, but I cannot touch ${member.toString()}. Lucky escape.`);
  }

  const timedOut = await member
    .timeout(TIMEOUT_MS, "Roulette: lost the spin")
    .then(() => true)
    .catch(() => false);

  return new EmbedBuilder()
    .setColor(timedOut ? EMBED_COLORS.ERROR : EMBED_COLORS.OK)
    .setDescription(
      timedOut
        ? `💥 Bang! ${member.toString()} is out for 5 minutes.`
        : `💥 The chamber was loaded, but something stopped me from following through.`
    );
}
