const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
} = require("discord.js");
const { EMBED_COLORS } = require("@root/config");
const { guildTranslator, interactionTranslator } = require("@src/i18n");
const {
  MEMBER_PICKERS,
  buildPanel,
  matchesButton,
  matchesModal,
  matchesSelect,
  modalId,
  parse,
  selectId,
} = require("@src/services/tempvoice/panel");
const {
  NAME_MAX_LENGTH,
  checkClaim,
  checkControl,
  checkTarget,
  normalizeLimit,
  normalizeName,
  renderChannelName,
} = require("@src/services/tempvoice/rules");
const {
  countOwned,
  deleteChannel,
  getChannel,
  listGuildChannels,
  pruneMissing,
  registerChannel,
} = require("@schemas/TempVoiceChannel");

// Used when the voice region list cannot be fetched from Discord.
const FALLBACK_REGIONS = [
  "brazil",
  "hongkong",
  "india",
  "japan",
  "rotterdam",
  "russia",
  "singapore",
  "southafrica",
  "sydney",
  "us-central",
  "us-east",
  "us-south",
  "us-west",
];

// Which @everyone permission each toggle button flips, and what to say afterwards.
const TOGGLES = {
  access: { field: "locked", permission: "Connect", on: "locked", off: "unlocked" },
  lobby: { field: "hidden", permission: "ViewChannel", on: "hidden", off: "shown" },
  chat: { field: "chat_locked", permission: "SendMessages", on: "chatLocked", off: "chatUnlocked" },
};

// Actions that pick from a fixed list rather than from every member of the server.
const LIST_PICKERS = {
  untrust: { source: "trusted", empty: "emptyTrusted" },
  unban: { source: "blocked", empty: "emptyBlocked" },
  kick: { source: "present", empty: "emptyMembers" },
  transfer: { source: "present", empty: "emptyMembers" },
};

/* ------------------------------------------------------------------ helpers */

/**
 * @param {import('discord.js').VoiceBasedChannel} channel
 * @returns {boolean}
 */
function canManage(channel) {
  return Boolean(channel.permissionsFor(channel.guild.members.me)?.has(PermissionFlagsBits.ManageChannels));
}

// The region list barely changes, and fetching it on every click puts a Discord
// round-trip between pressing the button and seeing the menu.
const regionCache = new Map();
const REGION_TTL_MS = 60 * 60 * 1000;

/**
 * @param {import('discord.js').Guild} guild
 * @returns {Promise<{value: string, label: string}[]>}
 */
async function fetchRegions(guild) {
  const cached = regionCache.get(guild.id);
  if (cached && cached.expires > Date.now()) return cached.regions;

  let regions = FALLBACK_REGIONS.map((id) => ({ value: id, label: id }));

  try {
    const fetched = await guild.fetchVoiceRegions();
    const usable = [...fetched.values()].filter((region) => !region.deprecated && !region.custom);
    if (usable.length) regions = usable.map((region) => ({ value: region.id, label: region.name }));
  } catch {
    // keep the static list
  }

  regionCache.set(guild.id, { regions, expires: Date.now() + REGION_TTL_MS });
  return regions;
}

/**
 * Where a member's channel is created and what it is called.
 *
 * @param {import('discord.js').GuildMember} member
 * @param {object} config guild temp_voice settings
 * @param {import('discord.js').VoiceBasedChannel} hub
 * @param {number} owned how many channels the member already has
 */
function buildChannelOptions(member, config, hub, owned) {
  const overwrites = [{ id: member.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect] }];
  if (config.default_locked) {
    overwrites.push({ id: member.guild.roles.everyone.id, deny: [PermissionFlagsBits.Connect] });
  }

  return {
    name: renderChannelName(config.name_template, {
      user: member.displayName || member.user.username,
      count: owned + 1,
    }),
    type: ChannelType.GuildVoice,
    parent: config.category_id || hub.parentId || null,
    userLimit: config.default_limit || 0,
    permissionOverwrites: overwrites,
    reason: `TempVoice channel for ${member.user.tag}`,
  };
}

/**
 * @param {import('discord.js').VoiceBasedChannel} channel
 * @param {string[]} ids
 * @returns {{value: string, label: string}[]}
 */
function memberOptions(channel, ids) {
  return ids.slice(0, 25).map((id) => {
    const member = channel.guild.members.cache.get(id);
    return { value: id, label: (member?.displayName || member?.user?.tag || id).slice(0, 100) };
  });
}

/**
 * Flip one @everyone permission and remember the new state on the record.
 *
 * @param {import('discord.js').VoiceBasedChannel} channel
 * @param {object} record TempVoice document
 * @param {{field: string, permission: string}} toggle
 * @returns {Promise<boolean>} the state after toggling
 */
async function togglePermission(channel, record, toggle) {
  const next = !record[toggle.field];

  await channel.permissionOverwrites.edit(channel.guild.roles.everyone, {
    [toggle.permission]: next ? false : null,
  });

  record[toggle.field] = next;
  await record.save();

  return next;
}

/* --------------------------------------------------------- channel lifecycle */

/**
 * Give a member joining the hub a channel of their own and move them into it.
 *
 * @param {import('discord.js').VoiceState} newState
 * @param {object} settings guild settings document
 */
async function handleHubJoin(newState, settings) {
  const config = settings?.temp_voice;
  if (!config?.enabled || !config.hub_channel_id) return;
  if (newState.channelId !== config.hub_channel_id) return;

  const member = newState.member;
  const guild = newState.guild;
  const t = guildTranslator(settings, guild);

  if (!guild.members.me.permissions.has(PermissionFlagsBits.ManageChannels)) return;

  const owned = await countOwned(guild.id, member.id);
  if (owned >= (config.max_per_member || 1)) {
    await member.send(t("tempvoice.errors.tooManyChannels")).catch(() => {});
    await member.voice.disconnect("TempVoice: channel limit reached").catch(() => {});
    return;
  }

  const channel = await guild.channels
    .create(buildChannelOptions(member, config, newState.channel, owned))
    .catch(() => null);
  if (!channel) return;

  await registerChannel({
    channelId: channel.id,
    guildId: guild.id,
    ownerId: member.id,
    locked: Boolean(config.default_locked),
  });

  const moved = await member.voice
    .setChannel(channel)
    .then(() => true)
    .catch(() => false);

  if (!moved) {
    // Nobody is in it and nobody is coming, so do not leave an orphan behind.
    await channel.delete("TempVoice: owner could not be moved in").catch(() => {});
    await deleteChannel(channel.id).catch(() => {});
    return;
  }

  if (config.panel_channel_id) {
    await member.send(t("tempvoice.hub.created", { channel: `<#${config.panel_channel_id}>` })).catch(() => {});
  }
}

/**
 * Delete a temporary channel once the last person leaves it.
 *
 * @param {import('discord.js').VoiceState} oldState
 */
async function handleChannelLeave(oldState) {
  const channel = oldState.channel;
  if (!channel || channel.members.size > 0) return;

  const record = await getChannel(channel.id);
  if (!record) return;

  await channel.delete("TempVoice: channel empty").catch(() => {});
  await deleteChannel(channel.id).catch(() => {});
}

/**
 * Drop records whose channels disappeared while the bot was offline, and clean up
 * temporary channels that came back empty.
 *
 * @param {import('discord.js').Guild} guild
 */
async function reconcileGuild(guild) {
  const records = await listGuildChannels(guild.id);
  if (!records.length) return;

  const alive = [];

  for (const record of records) {
    const channel = guild.channels.cache.get(record._id);
    if (!channel) continue;

    if (channel.members.size === 0) {
      await channel.delete("TempVoice: empty after restart").catch(() => {});
      continue;
    }

    alive.push(record._id);
  }

  await pruneMissing(guild.id, alive).catch(() => {});
}

/* ------------------------------------------------------------ button prompts */

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {import('discord.js').VoiceBasedChannel} channel
 * @param {(key: string, vars?: object) => string} t
 */
function showNameModal(interaction, channel, t) {
  const modal = new ModalBuilder()
    .setCustomId(modalId("name", channel.id))
    .setTitle(t("tempvoice.prompts.nameTitle"))
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("value")
          .setLabel(t("tempvoice.prompts.nameLabel").slice(0, 45))
          .setStyle(TextInputStyle.Short)
          .setMaxLength(NAME_MAX_LENGTH)
          .setValue(channel.name.slice(0, NAME_MAX_LENGTH))
          .setRequired(true)
      )
    );

  return interaction.showModal(modal);
}

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {import('discord.js').VoiceBasedChannel} channel
 * @param {(key: string, vars?: object) => string} t
 */
function showLimitModal(interaction, channel, t) {
  const modal = new ModalBuilder()
    .setCustomId(modalId("limit", channel.id))
    .setTitle(t("tempvoice.prompts.limitTitle"))
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("value")
          .setLabel(t("tempvoice.prompts.limitLabel").slice(0, 45))
          .setStyle(TextInputStyle.Short)
          .setMaxLength(2)
          .setValue(String(channel.userLimit || 0))
          .setRequired(true)
      )
    );

  return interaction.showModal(modal);
}

/* ------------------------------------------------------------------- exports */

module.exports = {
  buildPanel,
  matchesButton,
  matchesModal,
  matchesSelect,
  handleChannelLeave,
  handleHubJoin,
  reconcileGuild,

  /**
   * Post the panel members click on, replacing the previous one so a server never
   * ends up with two.
   *
   * @param {import('discord.js').TextBasedChannel} channel
   * @param {object} settings guild settings document
   * @param {{previousChannelId?: string}} [context] where the panel was, when the
   *   setting has already been pointed somewhere else
   */
  async postPanel(channel, settings, { previousChannelId } = {}) {
    const t = guildTranslator(settings, channel.guild);
    const config = settings.temp_voice;
    const from = previousChannelId || config.panel_channel_id;

    if (from && config.panel_message_id) {
      const previous = channel.guild.channels.cache.get(from);
      await previous?.messages
        ?.fetch(config.panel_message_id)
        .then((message) => message.delete())
        .catch(() => {});
    }

    const message = await channel.send(buildPanel(t, { settings, client: channel.client }));
    config.panel_channel_id = channel.id;
    config.panel_message_id = message.id;
    await settings.save();

    return message;
  },

  /**
   * @param {import('discord.js').ButtonInteraction} interaction
   * @param {object} settings guild settings document
   * @returns {Promise<boolean>} whether the interaction belonged to TempVoice
   */
  async handleButton(interaction, settings) {
    if (!matchesButton(interaction.customId)) return false;

    const { action } = parse(interaction.customId);
    const t = interactionTranslator(interaction, settings);
    const respond = (key, vars) => interaction.reply({ content: t(key, vars), ephemeral: true });

    if (!settings?.temp_voice?.enabled) {
      await respond("tempvoice.errors.disabled");
      return true;
    }

    const channel = interaction.member?.voice?.channel;
    if (!channel) {
      await respond("tempvoice.errors.notInVoice");
      return true;
    }

    const record = await getChannel(channel.id);
    if (!record) {
      await respond("tempvoice.errors.notTemporary");
      return true;
    }

    // Claiming is the one action somebody other than the owner may take.
    if (action === "claim") {
      if (settings.temp_voice.claimable === false) {
        await respond("tempvoice.errors.claimDisabled");
        return true;
      }

      const claim = checkClaim({ record, userId: interaction.user.id, memberIds: [...channel.members.keys()] });
      if (!claim.ok) {
        await respond(`tempvoice.errors.${claim.reason}`, { owner: `<@${claim.owner}>` });
        return true;
      }

      record.owner_id = interaction.user.id;
      await record.save();
      await channel.permissionOverwrites.edit(interaction.user, { ViewChannel: true, Connect: true }).catch(() => {});

      await respond("tempvoice.results.claimed");
      return true;
    }

    const control = checkControl({ record, userId: interaction.user.id });
    if (!control.ok) {
      await respond(`tempvoice.errors.${control.reason}`, { owner: `<@${control.owner}>` });
      return true;
    }

    if (!canManage(channel)) {
      await respond("tempvoice.errors.missingPermissions");
      return true;
    }

    // Modals have to be shown on an interaction that was not deferred first.
    if (action === "name") {
      await showNameModal(interaction, channel, t);
      return true;
    }

    if (action === "limit") {
      await showLimitModal(interaction, channel, t);
      return true;
    }

    if (LIST_PICKERS[action]) {
      const { source, empty } = LIST_PICKERS[action];
      const ids =
        source === "present"
          ? [...channel.members.keys()].filter((id) => id !== interaction.user.id)
          : record[source] || [];

      if (!ids.length) {
        await respond(`tempvoice.errors.${empty}`);
        return true;
      }

      await interaction.reply({
        components: [
          new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId(selectId(action, channel.id))
              .setPlaceholder(t(`tempvoice.prompts.${MEMBER_PICKERS[action]}`).slice(0, 150))
              .addOptions(memberOptions(channel, ids))
          ),
        ],
        ephemeral: true,
      });
      return true;
    }

    if (MEMBER_PICKERS[action]) {
      await interaction.reply({
        components: [
          new ActionRowBuilder().addComponents(
            new UserSelectMenuBuilder()
              .setCustomId(selectId(action, channel.id))
              .setPlaceholder(t(`tempvoice.prompts.${MEMBER_PICKERS[action]}`).slice(0, 150))
              .setMinValues(1)
              .setMaxValues(1)
          ),
        ],
        ephemeral: true,
      });
      return true;
    }

    if (TOGGLES[action]) {
      await interaction.deferReply({ ephemeral: true });

      const state = await togglePermission(channel, record, TOGGLES[action]).catch(() => null);
      if (state === null) {
        await interaction.editReply(t("tempvoice.errors.failed"));
        return true;
      }

      const toggle = TOGGLES[action];
      await interaction.editReply(t(`tempvoice.results.${state ? toggle.on : toggle.off}`));
      return true;
    }

    if (action === "region") {
      await interaction.deferReply({ ephemeral: true });
      const regions = await fetchRegions(channel.guild);

      await interaction.editReply({
        content: t("tempvoice.prompts.pickRegion"),
        components: [
          new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId(selectId("region", channel.id))
              .setPlaceholder(t("tempvoice.prompts.pickRegion").slice(0, 150))
              .addOptions(
                [{ value: "auto", label: t("tempvoice.prompts.regionAuto") }, ...regions]
                  .slice(0, 25)
                  .map((region) => ({ value: region.value, label: region.label.slice(0, 100) }))
              )
          ),
        ],
      });
      return true;
    }

    if (action === "delete") {
      await interaction.deferReply({ ephemeral: true });
      await interaction.editReply(t("tempvoice.results.deleted"));
      await channel.delete("TempVoice: deleted by owner").catch(() => {});
      await deleteChannel(channel.id).catch(() => {});
      return true;
    }

    await respond("tempvoice.errors.failed");
    return true;
  },

  /**
   * @param {import('discord.js').AnySelectMenuInteraction} interaction
   * @param {object} settings guild settings document
   * @returns {Promise<boolean>} whether the interaction belonged to TempVoice
   */
  async handleSelect(interaction, settings) {
    if (!matchesSelect(interaction.customId)) return false;

    const { action, ref: channelId } = parse(interaction.customId);
    const t = interactionTranslator(interaction, settings);
    await interaction.deferUpdate();

    // The picker replaces itself with the outcome, so a stale menu cannot be reused.
    const finish = (key, vars) => interaction.editReply({ content: t(key, vars), components: [] });

    const channel = interaction.guild.channels.cache.get(channelId);
    const record = channel ? await getChannel(channelId) : null;
    if (!channel || !record) {
      await finish("tempvoice.errors.notTemporary");
      return true;
    }

    const control = checkControl({ record, userId: interaction.user.id });
    if (!control.ok) {
      await finish(`tempvoice.errors.${control.reason}`, { owner: `<@${control.owner}>` });
      return true;
    }

    if (action === "region") {
      const value = interaction.values[0];
      const applied = await channel
        .setRTCRegion(value === "auto" ? null : value, "TempVoice: region changed by owner")
        .then(() => true)
        .catch(() => false);

      if (!applied) await finish("tempvoice.errors.failed");
      else if (value === "auto") await finish("tempvoice.results.regionAuto");
      else await finish("tempvoice.results.regionSet", { region: value });

      return true;
    }

    const targetId = interaction.values[0];
    const target = await interaction.guild.members.fetch(targetId).catch(() => null);
    if (!target) {
      await finish("tempvoice.errors.targetNotMember");
      return true;
    }

    const check = checkTarget({
      record,
      actorId: interaction.user.id,
      targetId,
      isBot: target.user.bot,
      // Undoing an earlier action must stay possible even if the list went stale.
      allowOwner: action === "unban" || action === "untrust",
    });
    if (!check.ok) {
      await finish(`tempvoice.errors.${check.reason}`);
      return true;
    }

    const mention = `<@${targetId}>`;

    try {
      switch (action) {
        case "trust":
          await channel.permissionOverwrites.edit(target, { ViewChannel: true, Connect: true });
          record.trusted = [...new Set([...record.trusted, targetId])];
          record.blocked = record.blocked.filter((id) => id !== targetId);
          await record.save();
          await finish("tempvoice.results.trusted", { user: mention });
          return true;

        case "untrust":
          await channel.permissionOverwrites.delete(target).catch(() => {});
          record.trusted = record.trusted.filter((id) => id !== targetId);
          await record.save();
          await finish("tempvoice.results.untrusted", { user: mention });
          return true;

        case "ban":
          await channel.permissionOverwrites.edit(target, { Connect: false, ViewChannel: false });
          record.blocked = [...new Set([...record.blocked, targetId])];
          record.trusted = record.trusted.filter((id) => id !== targetId);
          await record.save();
          if (target.voice?.channelId === channel.id) await target.voice.disconnect().catch(() => {});
          await finish("tempvoice.results.banned", { user: mention });
          return true;

        case "unban":
          await channel.permissionOverwrites.delete(target).catch(() => {});
          record.blocked = record.blocked.filter((id) => id !== targetId);
          await record.save();
          await finish("tempvoice.results.unbanned", { user: mention });
          return true;

        case "kick":
          if (target.voice?.channelId !== channel.id) {
            await finish("tempvoice.errors.targetNotInChannel", { user: mention });
            return true;
          }
          await target.voice.disconnect("TempVoice: kicked by owner");
          await finish("tempvoice.results.kicked", { user: mention });
          return true;

        case "transfer":
          record.owner_id = targetId;
          await record.save();
          await channel.permissionOverwrites.edit(target, { ViewChannel: true, Connect: true }).catch(() => {});
          await finish("tempvoice.results.transferred", { user: mention });
          return true;

        case "invite": {
          const invite = await channel
            .createInvite({ maxAge: 3600, maxUses: 1, reason: "TempVoice: invite from the channel owner" })
            .catch(() => null);

          const embed = new EmbedBuilder()
            .setColor(EMBED_COLORS.BOT_EMBED)
            .setTitle(t("tempvoice.invite.title"))
            .setDescription(
              t("tempvoice.invite.body", {
                user: `<@${interaction.user.id}>`,
                channel: channel.name,
                guild: interaction.guild.name,
              })
            );

          const components = invite
            ? [
                new ActionRowBuilder().addComponents(
                  new ButtonBuilder().setLabel(t("tempvoice.invite.join")).setStyle(ButtonStyle.Link).setURL(invite.url)
                ),
              ]
            : [];

          const sent = await target
            .send({ embeds: [embed], components })
            .then(() => true)
            .catch(() => false);

          await finish(sent ? "tempvoice.results.invited" : "tempvoice.results.inviteFailed", { user: mention });
          return true;
        }

        default:
          await finish("tempvoice.errors.failed");
          return true;
      }
    } catch (ex) {
      interaction.client.logger?.error("tempVoice: action failed", ex);
      await finish("tempvoice.errors.failed").catch(() => {});
      return true;
    }
  },

  /**
   * @param {import('discord.js').ModalSubmitInteraction} interaction
   * @param {object} settings guild settings document
   * @returns {Promise<boolean>} whether the interaction belonged to TempVoice
   */
  async handleModal(interaction, settings) {
    if (!matchesModal(interaction.customId)) return false;

    const { action, ref: channelId } = parse(interaction.customId);
    const t = interactionTranslator(interaction, settings);
    await interaction.deferReply({ ephemeral: true });

    const channel = interaction.guild.channels.cache.get(channelId);
    const record = channel ? await getChannel(channelId) : null;
    if (!channel || !record) {
      await interaction.editReply(t("tempvoice.errors.notTemporary"));
      return true;
    }

    const control = checkControl({ record, userId: interaction.user.id });
    if (!control.ok) {
      await interaction.editReply(t(`tempvoice.errors.${control.reason}`, { owner: `<@${control.owner}>` }));
      return true;
    }

    const raw = interaction.fields.getTextInputValue("value");

    if (action === "name") {
      const parsed = normalizeName(raw);
      if (!parsed.ok) {
        await interaction.editReply(t(`tempvoice.errors.${parsed.reason}`));
        return true;
      }

      const renamed = await channel
        .setName(parsed.value, "TempVoice: renamed by owner")
        .then(() => true)
        .catch(() => false);

      await interaction.editReply(
        renamed ? t("tempvoice.results.renamed", { name: parsed.value }) : t("tempvoice.errors.failed")
      );
      return true;
    }

    if (action === "limit") {
      const parsed = normalizeLimit(raw);
      if (!parsed.ok) {
        await interaction.editReply(t("tempvoice.errors.limitRange"));
        return true;
      }

      const applied = await channel
        .setUserLimit(parsed.value, "TempVoice: limit changed by owner")
        .then(() => true)
        .catch(() => false);

      if (!applied) {
        await interaction.editReply(t("tempvoice.errors.failed"));
        return true;
      }

      await interaction.editReply(
        parsed.value === 0
          ? t("tempvoice.results.limitCleared")
          : t("tempvoice.results.limitSet", { limit: parsed.value })
      );
      return true;
    }

    await interaction.editReply(t("tempvoice.errors.failed"));
    return true;
  },
};
