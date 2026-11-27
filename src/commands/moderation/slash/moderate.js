const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  EmbedBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
} = require("discord.js");
const { EMBED_COLORS } = require("@root/config");
const { interactionTranslator } = require("@src/i18n");
const {
  MAX_CHANNELS,
  MAX_PER_CHANNEL,
  MESSAGE_CHANNEL_TYPES,
  PURGE_METHODS,
  getMethod,
  runChannelPurge,
} = require("@src/services/moderation/channelPurge");

const IDLE_MS = 5 * 60 * 1000;
const IDLE_MINUTES = IDLE_MS / 60000;

/**
 * @param {string} session
 */
function idsFor(session) {
  return {
    channels: `mp:${session}:channels`,
    method: `mp:${session}:method`,
    user: `mp:${session}:user`,
    confirm: `mp:${session}:confirm`,
    cancel: `mp:${session}:cancel`,
    modal: (methodId) => `mp:${session}:modal:${methodId}`,
  };
}

/**
 * @param {string} color
 */
function embed(color = EMBED_COLORS.BOT_EMBED) {
  return new EmbedBuilder().setColor(color);
}

/**
 * @param {Function} t
 * @param {object} ids
 */
function channelPanel(t, ids) {
  const row = new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId(ids.channels)
      .setPlaceholder(t("moderate.channelsPlaceholder").slice(0, 150))
      .setChannelTypes(MESSAGE_CHANNEL_TYPES)
      .setMinValues(1)
      .setMaxValues(MAX_CHANNELS)
  );

  const cancel = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(ids.cancel).setLabel(t("common.cancel")).setStyle(ButtonStyle.Secondary)
  );

  const panel = embed()
    .setTitle(t("moderate.title"))
    .setDescription(t("moderate.description"))
    .setFooter({ text: t("moderate.footer", { minutes: IDLE_MINUTES }) });

  return { embeds: [panel], components: [row, cancel] };
}

/**
 * @param {Function} t
 * @param {object} ids
 * @param {Array} channels
 */
function methodPanel(t, ids, channels) {
  const options = PURGE_METHODS.map((method) => ({
    label: t(`moderate.methods.${method.id}`).slice(0, 100),
    description: t(`moderate.methodDescriptions.${method.id}`).slice(0, 100),
    value: method.id,
    emoji: method.emoji,
  }));

  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(ids.method)
      .setPlaceholder(t("moderate.methodPlaceholder").slice(0, 150))
      .addOptions(options)
  );

  const cancel = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(ids.cancel).setLabel(t("common.cancel")).setStyle(ButtonStyle.Secondary)
  );

  const panel = embed()
    .setTitle(t("moderate.title"))
    .setDescription(t("moderate.selectMethodDescription", { channels: channelList(channels) }));

  return { embeds: [panel], components: [row, cancel] };
}

/**
 * @param {Function} t
 * @param {object} ids
 * @param {Array} channels
 * @param {object} method
 */
function userPanel(t, ids, channels, method) {
  const row = new ActionRowBuilder().addComponents(
    new UserSelectMenuBuilder()
      .setCustomId(ids.user)
      .setPlaceholder(t("moderate.userPlaceholder").slice(0, 150))
      .setMinValues(1)
      .setMaxValues(1)
  );

  const cancel = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(ids.cancel).setLabel(t("common.cancel")).setStyle(ButtonStyle.Secondary)
  );

  const panel = embed()
    .setTitle(t("moderate.title"))
    .setDescription(
      `${t(`moderate.methods.${method.id}`)}\n${t("moderate.chooseUser")}\n\n` +
        t("moderate.channelsFieldValue", { channels: channelList(channels) })
    );

  return { embeds: [panel], components: [row, cancel] };
}

/**
 * @param {Function} t
 * @param {object} ids
 * @param {{channels: Array, method: object, amount: number, target: string|null}} selection
 */
function confirmPanel(t, ids, { channels, method, amount, target }) {
  const fields = [
    { name: t("moderate.channelsField"), value: channelList(channels), inline: false },
    { name: t("moderate.methodField"), value: t(`moderate.methods.${method.id}`), inline: true },
    { name: t("moderate.amountField"), value: String(amount), inline: true },
  ];
  if (target) fields.push({ name: t("moderate.targetField"), value: target, inline: true });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(ids.confirm).setLabel(t("moderate.confirm")).setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(ids.cancel).setLabel(t("common.cancel")).setStyle(ButtonStyle.Secondary)
  );

  const panel = embed(EMBED_COLORS.WARNING)
    .setTitle(t("moderate.confirmTitle"))
    .setDescription(t("moderate.confirmHint"))
    .setFields(fields);

  return { embeds: [panel], components: [row] };
}

/**
 * @param {Function} t
 * @param {object} outcome
 */
function resultPanel(t, outcome) {
  if (outcome.error) {
    const description = outcome.error === "INVALID_AMOUNT" ? t("moderate.badAmount") : t("moderate.invalidSelection");
    return {
      embeds: [embed(EMBED_COLORS.ERROR).setTitle(t("moderate.resultTitle")).setDescription(description)],
      components: [],
    };
  }

  const failed = outcome.results.filter((entry) => ["ERROR", "BOT_PERM", "MEMBER_PERM"].includes(entry.status)).length;
  const color =
    outcome.deleted > 0
      ? failed > 0
        ? EMBED_COLORS.WARNING
        : EMBED_COLORS.SUCCESS
      : failed > 0
        ? EMBED_COLORS.ERROR
        : EMBED_COLORS.WARNING;

  const lines = outcome.results.map((entry) => {
    const channel = entry.channelId ? `<#${entry.channelId}>` : entry.name || "—";
    return `${resultIcon(entry.status)} ${channel} — ${resultText(t, entry)}`;
  });

  const panel = embed(color)
    .setTitle(t("moderate.resultTitle"))
    .setDescription(
      `${t("moderate.resultSummary", {
        deleted: outcome.deleted,
        channels: outcome.results.length,
        failed,
      })}\n\n${lines.join("\n") || t("moderate.noChannels")}`
    );

  return { embeds: [panel], components: [] };
}

/**
 * @param {string} status
 */
function resultIcon(status) {
  switch (status) {
    case "OK":
      return "✅";
    case "NO_MESSAGES":
      return "➖";
    case "MEMBER_PERM":
      return "⛔";
    case "BOT_PERM":
      return "🤖";
    case "SKIPPED":
      return "⏭️";
    default:
      return "⚠️";
  }
}

/**
 * @param {Function} t
 * @param {{channelId: string|null, name: string, status: string, deleted: number}} entry
 */
function resultText(t, entry) {
  switch (entry.status) {
    case "OK":
      return t("moderate.results.deleted", { count: entry.deleted });
    case "NO_MESSAGES":
      return t("moderate.results.none");
    case "MEMBER_PERM":
      return t("moderate.results.memberPerm");
    case "BOT_PERM":
      return t("moderate.results.botPerm");
    case "SKIPPED":
      return t("moderate.results.skipped");
    default:
      return t("moderate.results.error");
  }
}

/**
 * @param {Array} channels
 */
function channelList(channels) {
  return channels
    .map((channel) => `<#${channel.id}>`)
    .join(", ")
    .slice(0, 1024);
}

/**
 * @param {Function} t
 * @param {string} description
 */
function errorPanel(t, description) {
  return {
    embeds: [embed(EMBED_COLORS.ERROR).setTitle(t("moderate.title")).setDescription(description)],
    components: [],
  };
}

/**
 * An ephemeral panel lives on the interaction webhook rather than in the
 * channel, so it can only be edited back through the interaction.
 *
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @param {Function} t
 */
function expirePanel(interaction, t) {
  return interaction.editReply(errorPanel(t, t("moderate.expired"))).catch(() => {});
}

/**
 * @param {Function} t
 */
function cancelledPanel(t) {
  return {
    embeds: [embed(EMBED_COLORS.WARNING).setTitle(t("moderate.title")).setDescription(t("moderate.cancelled"))],
    components: [],
  };
}

/**
 * Wait for a component of this panel from its owner, or give up on idle.
 *
 * @param {import('discord.js').Message} message
 * @param {string} userId
 * @param {string[]} accepted custom ids
 */
function waitFor(message, userId, accepted) {
  return message
    .awaitMessageComponent({
      filter: (component) => component.user.id === userId && accepted.includes(component.customId),
      time: IDLE_MS,
    })
    .catch(() => null);
}

/**
 * Open the amount modal and wait for it to be submitted.
 *
 * @param {import('discord.js').MessageComponentInteraction} component
 * @param {string} userId
 * @param {Function} t
 * @param {string} modalId
 * @param {object} method
 */
async function askParameters(component, userId, t, modalId, method) {
  const rows = [
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("amount")
        .setLabel(t("moderate.amountLabel").slice(0, 45))
        .setPlaceholder(t("moderate.amountHint").slice(0, 100))
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(3)
        .setValue("25")
    ),
  ];

  if (method.needsText) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("text")
          .setLabel(t("moderate.textLabel").slice(0, 45))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(100)
      )
    );
  }

  await component.showModal(
    new ModalBuilder().setCustomId(modalId).setTitle(t("moderate.modalTitle").slice(0, 45)).addComponents(rows)
  );

  return component
    .awaitModalSubmit({
      filter: (submit) => submit.customId === modalId && submit.user.id === userId,
      time: IDLE_MS,
    })
    .catch(() => null);
}

/**
 * @type {import("@structures/Command")}
 */
module.exports = {
  name: "moderate",
  description: "moderate messages in one or more channels, voice channels included",
  category: "MODERATION",
  userPermissions: ["ManageMessages"],
  botPermissions: ["ManageMessages", "ReadMessageHistory", "EmbedLinks"],
  command: {
    enabled: false,
  },
  slashCommand: {
    enabled: true,
    ephemeral: true,
    options: [],
  },

  async interactionRun(interaction, data) {
    const t = interactionTranslator(interaction, data.settings);
    const userId = interaction.user.id;
    const ids = idsFor(interaction.id);

    const message = await interaction.safeFollowUp(channelPanel(t, ids));
    if (!message) return;

    const channelPick = await waitFor(message, userId, [ids.channels, ids.cancel]);
    if (!channelPick) return expirePanel(interaction, t);
    if (channelPick.customId === ids.cancel) return channelPick.update(cancelledPanel(t));

    const channels = channelPick.values
      .map((channelId) => channelPick.channels.get(channelId) ?? channelPick.guild.channels.cache.get(channelId))
      .filter(Boolean);
    if (channels.length === 0) return channelPick.update(errorPanel(t, t("moderate.noChannels")));
    await channelPick.update(methodPanel(t, ids, channels));

    const methodPick = await waitFor(message, userId, [ids.method, ids.cancel]);
    if (!methodPick) return expirePanel(interaction, t);
    if (methodPick.customId === ids.cancel) return methodPick.update(cancelledPanel(t));

    const method = getMethod(methodPick.values[0]);
    if (!method) return methodPick.update(errorPanel(t, t("moderate.invalidSelection")));

    let user = null;
    let submit;
    if (method.needsUser) {
      await methodPick.update(userPanel(t, ids, channels, method));
      const userPick = await waitFor(message, userId, [ids.user, ids.cancel]);
      if (!userPick) return expirePanel(interaction, t);
      if (userPick.customId === ids.cancel) return userPick.update(cancelledPanel(t));

      user = userPick.users.first();
      if (!user) return userPick.update(errorPanel(t, t("moderate.invalidSelection")));
      submit = await askParameters(userPick, userId, t, ids.modal(method.id), method);
    } else {
      submit = await askParameters(methodPick, userId, t, ids.modal(method.id), method);
    }

    if (!submit) return expirePanel(interaction, t);

    const requested = Number.parseInt(submit.fields.getTextInputValue("amount").trim(), 10);
    if (!Number.isInteger(requested) || requested < 1) {
      return submit.update(errorPanel(t, t("moderate.badAmount")));
    }
    const amount = Math.min(requested, MAX_PER_CHANNEL);
    const text = method.needsText ? submit.fields.getTextInputValue("text").trim() : null;
    if (method.needsText && !text) return submit.update(errorPanel(t, t("moderate.badText")));
    const target = user ? `<@${user.id}>` : text ? `\`${text}\`` : null;

    await submit.update(confirmPanel(t, ids, { channels, method, amount, target }));

    const decision = await waitFor(message, userId, [ids.confirm, ids.cancel]);
    if (!decision) return expirePanel(interaction, t);
    if (decision.customId === ids.cancel) return decision.update(cancelledPanel(t));

    await decision.deferUpdate();
    const outcome = await runChannelPurge({
      issuer: interaction.member,
      channels,
      methodId: method.id,
      amount,
      argument: user ? user.id : text || undefined,
    });

    return decision.editReply(resultPanel(t, outcome));
  },
};
