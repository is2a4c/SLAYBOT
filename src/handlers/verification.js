const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");
const { EMBED_COLORS } = require("@root/config");
const { generateCode, matchesCode, renderCaptchaImage } = require("@src/services/verification/Captcha");
const { applyBranding, resolveBranding } = require("@helpers/Branding");
const { clearChallenge, getChallenge, registerTry, startChallenge } = require("@schemas/VerificationAttempt");

const BUTTON_ID = "VERIFY_START";
const MODAL_ID = "VERIFY_MODAL";
const CHALLENGE_TTL_MS = 10 * 60 * 1000;
const MAX_TRIES = 3;

/**
 * @param {object} config guild verification settings
 * @param {{settings?: object, client?: import('discord.js').Client}} [context] guild branding
 */
function buildPanel(config, { settings, client } = {}) {
  const embed = new EmbedBuilder()
    .setColor(config.color || EMBED_COLORS.BOT_EMBED)
    .setTitle(config.title || "Verification")
    .setDescription(
      config.description ||
        (config.mode === "CAPTCHA"
          ? "Press the button, read the code from the image and type it in to get access."
          : "Press the button to confirm you are human and get access.")
    );

  if (!config.color) applyBranding(embed, resolveBranding(settings, client), { force: true });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(BUTTON_ID)
      .setLabel(config.button_label || "Verify")
      .setStyle(ButtonStyle.Success)
      .setEmoji("✅")
  );

  return { embeds: [embed], components: [row] };
}

/**
 * Decide whether a member may verify at all.
 *
 * Pure so the guard rules are testable: already verified, missing role, or a
 * role the bot cannot assign.
 *
 * @param {{config: object, memberRoleIds: string[]|Set<string>, botHighest: number, rolePosition: number|null, roleManaged?: boolean}} input
 * @returns {{ok: boolean, reason: string|null}}
 */
function checkEligibility({ config, memberRoleIds, botHighest, rolePosition, roleManaged = false }) {
  if (!config?.enabled) return { ok: false, reason: "Verification is not enabled on this server." };
  if (!config.role_id) return { ok: false, reason: "No verified role is configured. Ask an admin to set one." };

  const held = memberRoleIds instanceof Set ? memberRoleIds : new Set(memberRoleIds || []);
  if (held.has(config.role_id)) return { ok: false, reason: "You are already verified." };

  if (rolePosition === null || rolePosition === undefined) {
    return { ok: false, reason: "The verified role no longer exists. Ask an admin to set it again." };
  }
  if (roleManaged) return { ok: false, reason: "The verified role is managed by an integration." };
  if (botHighest <= rolePosition) {
    return { ok: false, reason: "I cannot assign the verified role. Ask an admin to move my role higher." };
  }

  return { ok: true, reason: null };
}

/**
 * @param {import('discord.js').GuildMember} member
 * @param {object} config
 */
async function grantAccess(member, config) {
  const role = member.guild.roles.cache.get(config.role_id);
  if (role) await member.roles.add(role, "Verification passed");

  if (config.remove_role_id) {
    const unverified = member.guild.roles.cache.get(config.remove_role_id);
    if (unverified && member.roles.cache.has(unverified.id)) {
      await member.roles.remove(unverified, "Verification passed").catch(() => {});
    }
  }

  // Housekeeping the member is not waiting on: cleared and logged in the
  // background so the reply lands as soon as the role is on.
  clearChallenge(member.guild.id, member.id).catch(() => {});

  if (config.log_channel) {
    const channel = member.guild.channels.cache.get(config.log_channel);
    if (channel?.isTextBased()) {
      channel
        .send({
          embeds: [
            new EmbedBuilder()
              .setColor(EMBED_COLORS.SUCCESS)
              .setAuthor({ name: "Member verified" })
              .setDescription(`${member} \`${member.id}\``)
              .setTimestamp(),
          ],
        })
        .catch(() => {});
    }
  }
}

module.exports = {
  BUTTON_ID,
  MODAL_ID,
  CHALLENGE_TTL_MS,
  MAX_TRIES,
  buildPanel,
  checkEligibility,
  grantAccess,

  /**
   * @param {import('discord.js').ButtonInteraction} interaction
   * @param {object} settings guild settings document
   */
  async handleVerifyButton(interaction, settings) {
    const config = settings?.verification;
    const role = config?.role_id ? interaction.guild.roles.cache.get(config.role_id) : null;

    const eligibility = checkEligibility({
      config,
      memberRoleIds: interaction.member.roles.cache.map((r) => r.id),
      botHighest: interaction.guild.members.me.roles.highest.position,
      rolePosition: role ? role.position : null,
      roleManaged: role?.managed,
    });

    if (!eligibility.ok) return interaction.reply({ content: eligibility.reason, ephemeral: true });

    // Everything past here talks to the database, Discord or the image encoder,
    // so the click is acknowledged first rather than after all of it.
    await interaction.deferReply({ ephemeral: true });

    if (config.mode !== "CAPTCHA") {
      try {
        await grantAccess(interaction.member, config);
      } catch (ex) {
        interaction.client.logger?.error("verification: failed to grant role", ex);
        return interaction.editReply("I could not give you the role. Ask an admin to check my permissions.");
      }
      return interaction.editReply("You are verified. Welcome!");
    }

    const code = generateCode(config.captcha_length || 6);
    await startChallenge({
      guildId: interaction.guildId,
      userId: interaction.user.id,
      code,
      ttlMs: CHALLENGE_TTL_MS,
    });

    const image = await renderCaptchaImage(code);
    await interaction.editReply({
      content: "Read the code from the image, then press **Enter code** and type it in. It expires in 10 minutes.",
      files: [image],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(MODAL_ID).setLabel("Enter code").setStyle(ButtonStyle.Primary)
        ),
      ],
    });
  },

  /**
   * @param {import('discord.js').ButtonInteraction} interaction
   */
  async handleCodePrompt(interaction) {
    const modal = new ModalBuilder()
      .setCustomId(MODAL_ID)
      .setTitle("Verification")
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("code")
            .setLabel("Code from the image")
            .setStyle(TextInputStyle.Short)
            .setMinLength(4)
            .setMaxLength(12)
            .setRequired(true)
        )
      );

    return interaction.showModal(modal);
  },

  /**
   * @param {import('discord.js').ModalSubmitInteraction} interaction
   * @param {object} settings guild settings document
   */
  async handleCodeSubmit(interaction, settings) {
    const config = settings?.verification;
    await interaction.deferReply({ ephemeral: true });

    const challenge = await getChallenge(interaction.guildId, interaction.user.id);
    if (!challenge) {
      return interaction.editReply("That challenge expired. Press **Verify** again for a new code.");
    }

    if (!matchesCode(challenge.code, interaction.fields.getTextInputValue("code"))) {
      const updated = await registerTry(interaction.guildId, interaction.user.id);
      const left = MAX_TRIES - (updated?.tries || 1);

      if (left <= 0) {
        await clearChallenge(interaction.guildId, interaction.user.id).catch(() => {});
        return interaction.editReply("That code was wrong too many times. Press **Verify** for a new code.");
      }

      return interaction.editReply(`That code is wrong. ${left} attempt${left === 1 ? "" : "s"} left.`);
    }

    try {
      await grantAccess(interaction.member, config);
    } catch (ex) {
      interaction.client.logger?.error("verification: failed to grant role", ex);
      return interaction.editReply("The code was right, but I could not give you the role. Tell an admin.");
    }

    return interaction.editReply("Verified. Welcome!");
  },
};
