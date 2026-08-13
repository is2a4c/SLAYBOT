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
const { guildTranslator } = require("@src/i18n");
const { clearChallenge, getChallenge, registerTry, startChallenge } = require("@schemas/VerificationAttempt");

const BUTTON_ID = "VERIFY_START";
const MODAL_ID = "VERIFY_MODAL";
const CHALLENGE_TTL_MS = 10 * 60 * 1000;
const MAX_TRIES = 3;

// What the schema stores until a server writes its own wording. Left as-is these
// would pin an English panel onto a Russian server, so they fall back to the
// translation instead of being shown.
const SCHEMA_TITLE = "Verification";
const SCHEMA_BUTTON = "Verify";

/**
 * The panel members press to get in.
 *
 * Everything on it can be set per server; what a server has not set is written in
 * the language that server speaks rather than in English.
 *
 * @param {object} config guild verification settings
 * @param {{settings?: object, client?: import('discord.js').Client, guild?: import('discord.js').Guild}} [context]
 */
function buildPanel(config, { settings, client, guild } = {}) {
  const t = guildTranslator(settings, guild);
  const captcha = config.mode === "CAPTCHA";
  const own = (value, schemaDefault) => (value && value !== schemaDefault ? value : null);

  const embed = new EmbedBuilder()
    .setColor(config.color || EMBED_COLORS.BOT_EMBED)
    .setTitle(`🛡️ ${own(config.title, SCHEMA_TITLE) || t("verification.panel.title")}`)
    .setDescription(config.description || t(captcha ? "verification.panel.captcha" : "verification.panel.button"));

  if (!config.color) applyBranding(embed, resolveBranding(settings, client), { force: true });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(BUTTON_ID)
      .setLabel(own(config.button_label, SCHEMA_BUTTON) || t("verification.panel.action"))
      .setStyle(ButtonStyle.Success)
      .setEmoji(captcha ? "🔠" : "✅")
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
    const ttlMinutes = Math.min(60, Math.max(1, Number(config.challenge_ttl_minutes) || 10));
    await startChallenge({
      guildId: interaction.guildId,
      userId: interaction.user.id,
      code,
      ttlMs: ttlMinutes * 60 * 1000,
    });

    const image = await renderCaptchaImage(code);
    await interaction.editReply({
      content: `Read the code from the image, then press **Enter code** and type it in. It expires in ${ttlMinutes} minute${ttlMinutes === 1 ? "" : "s"}.`,
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
      const maxTries = Math.min(10, Math.max(1, Number(config.max_tries) || MAX_TRIES));
      const left = maxTries - (updated?.tries || 1);

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
