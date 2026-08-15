const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
} = require("discord.js");
const { EMBED_COLORS } = require("@root/config");
const { getSettings } = require("@schemas/Guild");
const { guildTranslator, interactionTranslator } = require("@src/i18n");
const {
  claimPhaseTransition,
  countActiveSessions,
  createSession,
  deleteSession,
  findSessionForMember,
  getSession,
} = require("@schemas/ForestFussSession");
const {
  MIN_PLAYERS,
  categoryId,
  forestFussEnabled,
  leadersOnly,
  lobbyName,
  maxPlayers,
  maxSessions,
  phaseSeconds,
  wolvesName,
} = require("./policy");
const { assignRoles, canControl, checkWin, tally } = require("./engine");

const TASK_TYPE = "FUSS_PHASE_END";
const PREFIX_JOIN = "FUSS_JOIN";
const PREFIX_LEAVE = "FUSS_LEAVE";
const PREFIX_SKIP = "FUSS_SKIP";
const PREFIX_STOP = "FUSS_STOP";
const PREFIX_VOTE = "FUSS_VOTE";

const dedupeKey = (lobbyChannelId) => `fuss-phase-${lobbyChannelId}`;
const joinId = (id) => `${PREFIX_JOIN}:${id}`;
const leaveId = (id) => `${PREFIX_LEAVE}:${id}`;
const skipId = (id) => `${PREFIX_SKIP}:${id}`;
const stopId = (id) => `${PREFIX_STOP}:${id}`;
const voteId = (id) => `${PREFIX_VOTE}:${id}`;

/* -------------------------------------------------------------- rendering */

function relativeTime(date) {
  return `<t:${Math.floor(new Date(date).getTime() / 1000)}:R>`;
}

/**
 * @param {import('discord.js').Guild} guild
 * @param {string} userId
 */
function memberLabel(guild, userId) {
  const member = guild.members.cache.get(userId);
  return member?.displayName || member?.user?.username || userId;
}

function phaseColor(session) {
  if (session.phase === "NIGHT") return EMBED_COLORS.INFO;
  if (session.phase === "RESULT") return session.winner === "WOLVES" ? EMBED_COLORS.ERROR : EMBED_COLORS.OK;
  return EMBED_COLORS.BOT_EMBED;
}

/**
 * @param {object} session
 * @param {object} settings
 * @param {import('discord.js').Guild} guild
 */
function buildLobbyEmbed(session, settings, guild) {
  const t = guildTranslator(settings, guild);
  const embed = new EmbedBuilder().setColor(phaseColor(session)).setTitle(t("forestFuss.lobby.title"));

  if (session.phase === "RECRUITMENT") {
    embed.setDescription(
      t("forestFuss.lobby.recruitmentDescription", {
        count: session.players.length,
        max: maxPlayers(settings),
        time: relativeTime(session.phase_ends_at),
      })
    );
    embed.addFields({
      name: t("forestFuss.lobby.players"),
      value: session.players.map((player) => `<@${player.user_id}>`).join("\n") || "—",
    });
  } else if (session.phase === "DAY") {
    const alive = session.players.filter((player) => player.alive);
    embed.setDescription(
      t("forestFuss.lobby.dayDescription", {
        round: session.round,
        alive: alive.length,
        votes: session.votes.length,
        time: relativeTime(session.phase_ends_at),
      })
    );
  } else if (session.phase === "NIGHT") {
    const alive = session.players.filter((player) => player.alive);
    embed.setDescription(
      t("forestFuss.lobby.nightDescription", {
        round: session.round,
        alive: alive.length,
        time: relativeTime(session.phase_ends_at),
      })
    );
  } else if (session.phase === "RESULT") {
    embed.setDescription(
      session.winner === "WOLVES" ? t("forestFuss.lobby.resultWolves") : t("forestFuss.lobby.resultVillagers")
    );
    embed.addFields({
      name: t("forestFuss.lobby.roles"),
      value: session.players
        .map((player) => `<@${player.user_id}> — ${t(`forestFuss.roles.${player.role}`)}${player.alive ? "" : " 💀"}`)
        .join("\n"),
    });
  }

  return embed;
}

/**
 * @param {object} session
 * @param {{value: string, label: string}[]} voters who gets a vote
 * @param {{value: string, label: string}[]} targets who can be voted for
 * @param {(key: string, vars?: object) => string} t
 */
function buildVoteRow(session, targets, t) {
  const options = targets.slice(0, 25).map((target) => ({ label: target.label.slice(0, 100), value: target.value }));
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(voteId(session._id))
      .setPlaceholder(t("forestFuss.vote.placeholder"))
      .addOptions(options)
  );
}

/**
 * @param {object} session
 * @param {object} settings
 * @param {import('discord.js').Guild} guild
 */
function buildLobbyComponents(session, settings, guild) {
  const t = guildTranslator(settings, guild);
  if (session.phase === "RESULT" || session.phase === "TRANSITIONING") return [];

  const rows = [];

  if (session.phase === "RECRUITMENT") {
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(joinId(session._id))
          .setLabel(t("forestFuss.buttons.join"))
          .setEmoji("✅")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(leaveId(session._id))
          .setLabel(t("forestFuss.buttons.leave"))
          .setEmoji("🚪")
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(skipId(session._id))
          .setLabel(t("forestFuss.buttons.startNow"))
          .setEmoji("⏩")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(stopId(session._id))
          .setLabel(t("forestFuss.buttons.stop"))
          .setEmoji("🛑")
          .setStyle(ButtonStyle.Danger)
      )
    );
    return rows;
  }

  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(skipId(session._id))
        .setLabel(t("forestFuss.buttons.skip"))
        .setEmoji("⏩")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(stopId(session._id))
        .setLabel(t("forestFuss.buttons.stop"))
        .setEmoji("🛑")
        .setStyle(ButtonStyle.Danger)
    )
  );

  if (session.phase === "DAY") {
    const alive = session.players.filter((player) => player.alive);
    if (alive.length) {
      rows.push(
        buildVoteRow(
          session,
          alive.map((player) => ({ value: player.user_id, label: memberLabel(guild, player.user_id) })),
          t
        )
      );
    }
  }

  return rows;
}

/**
 * @param {import('discord.js').Client} client
 * @param {object} session
 * @param {object} settings
 */
async function renderLobby(client, session, settings) {
  const channel = await client.channels.fetch(session._id).catch(() => null);
  if (!channel) return;

  const view = {
    embeds: [buildLobbyEmbed(session, settings, channel.guild)],
    components: buildLobbyComponents(session, settings, channel.guild),
  };

  if (session.message_id) {
    const message = await channel.messages.fetch(session.message_id).catch(() => null);
    if (message) {
      await message.edit(view).catch(() => {});
      return;
    }
  }

  const sent = await channel.send(view).catch(() => null);
  if (sent) {
    session.message_id = sent.id;
    await session.save();
  }
}

/**
 * @param {import('discord.js').Client} client
 * @param {object} session
 * @param {object} settings
 */
async function renderWolves(client, session, settings) {
  if (!session.wolves_channel_id) return;
  const channel = await client.channels.fetch(session.wolves_channel_id).catch(() => null);
  if (!channel) return;

  const t = guildTranslator(settings, channel.guild);
  const aliveWolves = session.players.filter((player) => player.alive && player.role === "WOLF");
  const aliveVillagers = session.players.filter((player) => player.alive && player.role === "VILLAGER");

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLORS.ERROR)
    .setTitle(t("forestFuss.wolves.title"))
    .setDescription(t("forestFuss.wolves.description", { alive: aliveWolves.length }));

  const components = aliveVillagers.length
    ? [
        buildVoteRow(
          session,
          aliveVillagers.map((player) => ({
            value: player.user_id,
            label: memberLabel(channel.guild, player.user_id),
          })),
          t
        ),
      ]
    : [];

  await channel.send({ embeds: [embed], components }).catch(() => {});
}

/* --------------------------------------------------------------- channels */

/**
 * @param {import('discord.js').Guild} guild
 * @param {object} settings
 */
function resolveCategory(guild, settings) {
  const id = categoryId(settings);
  if (!id) return null;
  const channel = guild.channels.cache.get(id);
  return channel?.type === ChannelType.GuildCategory ? channel : null;
}

async function createLobbyChannel(guild, settings, activeCount, category) {
  const base = lobbyName(settings);
  return guild.channels.create({
    name: activeCount > 0 ? `${base}-${activeCount + 1}` : base,
    type: ChannelType.GuildText,
    parent: category?.id || null,
    reason: "Forest Fuss: new lobby",
  });
}

async function createWolvesChannel(guild, settings, lobby, wolfIds, category) {
  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: guild.members.me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
    ...wolfIds.map((id) => ({ id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] })),
  ];

  return guild.channels.create({
    name: wolvesName(settings),
    type: ChannelType.GuildText,
    parent: category?.id || lobby.parentId || null,
    permissionOverwrites: overwrites,
    reason: "Forest Fuss: wolves channel",
  });
}

async function dmWolves(guild, settings, wolfIds, wolvesChannel) {
  if (!wolvesChannel) return;
  const t = guildTranslator(settings, guild);

  await Promise.all(
    wolfIds.map(async (id) => {
      const member = guild.members.cache.get(id) || (await guild.members.fetch(id).catch(() => null));
      await member
        ?.send(t("forestFuss.dm.wolfChannel", { guild: guild.name, channel: `<#${wolvesChannel.id}>` }))
        .catch(() => {});
    })
  );
}

/**
 * Delete whatever this session created and forget about it. Safe to call on
 * a session whose channels are already gone.
 *
 * @param {import('discord.js').Client} client
 * @param {object} session
 * @param {import('discord.js').Guild|null} guild
 */
async function cleanupSession(client, session, guild) {
  await client.scheduler?.cancel({ dedupeKey: dedupeKey(session._id) }).catch(() => {});

  if (session.wolves_channel_id) {
    const wolvesChannel =
      guild?.channels.cache.get(session.wolves_channel_id) ||
      (await guild?.channels.fetch(session.wolves_channel_id).catch(() => null));
    await wolvesChannel?.delete("Forest Fuss: game ended").catch(() => {});
  }

  const lobby = guild?.channels.cache.get(session._id) || (await guild?.channels.fetch(session._id).catch(() => null));
  await lobby?.delete("Forest Fuss: game ended").catch(() => {});

  await deleteSession(session._id).catch(() => {});
}

/* ------------------------------------------------------------- lifecycle */

/**
 * @param {import('discord.js').Client} client
 * @param {import('discord.js').Guild} guild
 * @param {object} session
 * @param {object} settings
 * @param {"RECRUITMENT"|"DAY"|"NIGHT"|"RESULT"} phase
 */
async function beginPhase(client, guild, session, settings, phase) {
  session.phase = phase;
  session.phase_ends_at = new Date(Date.now() + phaseSeconds(settings, phase.toLowerCase()) * 1000);
  await session.save();

  await client.scheduler
    ?.schedule({
      type: TASK_TYPE,
      guildId: session.guild_id,
      runAt: session.phase_ends_at,
      payload: { lobbyChannelId: session._id, phase },
      dedupeKey: dedupeKey(session._id),
    })
    .catch(() => {});

  await renderLobby(client, session, settings).catch(() => {});
  if (phase === "NIGHT") await renderWolves(client, session, settings).catch(() => {});
}

/**
 * @param {{client: import('discord.js').Client, guild: import('discord.js').Guild, leader: import('discord.js').GuildMember, settings: object}} input
 */
async function startSession({ client, guild, leader, settings }) {
  const t = guildTranslator(settings, guild);

  if (!forestFussEnabled(settings)) return { ok: false, message: t("forestFuss.disabled") };

  if (!guild.members.me.permissions.has([PermissionFlagsBits.ManageChannels, PermissionFlagsBits.EmbedLinks])) {
    return { ok: false, message: t("forestFuss.missingPermissions") };
  }

  const existing = await findSessionForMember(guild.id, leader.id);
  if (existing) return { ok: false, message: t("forestFuss.alreadyInGame") };

  const cap = maxSessions(settings);
  const active = await countActiveSessions(guild.id);
  if (active >= cap) return { ok: false, message: t("forestFuss.tooManySessions", { max: cap }) };

  if (categoryId(settings) && !resolveCategory(guild, settings)) {
    return { ok: false, message: t("forestFuss.missingCategory") };
  }

  const lobby = await createLobbyChannel(guild, settings, active, resolveCategory(guild, settings)).catch(() => null);
  if (!lobby) return { ok: false, message: t("forestFuss.createFailed") };

  const session = await createSession({ lobbyChannelId: lobby.id, guildId: guild.id, leaderId: leader.id }).catch(
    () => null
  );
  if (!session) {
    await lobby.delete("Forest Fuss: session create failed").catch(() => {});
    return { ok: false, message: t("forestFuss.createFailed") };
  }

  await beginPhase(client, guild, session, settings, "RECRUITMENT");
  return { ok: true, channel: lobby };
}

/**
 * @param {import('discord.js').Client} client
 * @param {import('discord.js').Guild} guild
 * @param {object} session claimed, phase already TRANSITIONING
 * @param {object} settings
 */
async function finishRecruitment(client, guild, session, settings) {
  const t = guildTranslator(settings, guild);
  const lobby = guild.channels.cache.get(session._id) || (await guild.channels.fetch(session._id).catch(() => null));

  if (session.players.length < MIN_PLAYERS) {
    await lobby?.send(t("forestFuss.errors.notEnoughPlayers", { min: MIN_PLAYERS })).catch(() => {});
    await cleanupSession(client, session, guild);
    return;
  }

  const assigned = assignRoles(session.players.map((player) => player.user_id));
  session.players = assigned;
  session.round = 1;
  session.votes = [];

  const wolfIds = assigned.filter((player) => player.role === "WOLF").map((player) => player.user_id);
  const category = resolveCategory(guild, settings);
  const wolvesChannel = lobby
    ? await createWolvesChannel(guild, settings, lobby, wolfIds, category).catch(() => null)
    : null;
  session.wolves_channel_id = wolvesChannel?.id || null;

  await dmWolves(guild, settings, wolfIds, wolvesChannel);
  await beginPhase(client, guild, session, settings, "DAY");
}

/**
 * @param {import('discord.js').Client} client
 * @param {import('discord.js').Guild} guild
 * @param {object} session claimed, phase already TRANSITIONING
 * @param {object} settings
 * @param {"DAY"|"NIGHT"} phase which voting phase just ended
 */
async function finishVotingPhase(client, guild, session, settings, phase) {
  const t = guildTranslator(settings, guild);
  const lobby = guild.channels.cache.get(session._id) || (await guild.channels.fetch(session._id).catch(() => null));

  const alive = session.players.filter((player) => player.alive);
  const aliveIds = new Set(alive.map((player) => player.user_id));
  const eligibleVotes =
    phase === "NIGHT"
      ? session.votes.filter(
          (vote) => session.players.find((player) => player.user_id === vote.voter_id)?.role === "WOLF"
        )
      : session.votes;

  const eliminatedId = tally(eligibleVotes, aliveIds);

  if (eliminatedId) {
    const player = session.players.find((entry) => entry.user_id === eliminatedId);
    player.alive = false;
    const key = phase === "DAY" ? "forestFuss.announce.dayEliminated" : "forestFuss.announce.nightEliminated";
    await lobby
      ?.send(t(key, { name: memberLabel(guild, eliminatedId), role: t(`forestFuss.roles.${player.role}`) }))
      .catch(() => {});
  } else {
    const key = phase === "DAY" ? "forestFuss.announce.dayNoElimination" : "forestFuss.announce.nightNoElimination";
    await lobby?.send(t(key)).catch(() => {});
  }

  session.votes = [];

  const winner = checkWin(session.players);
  if (winner) {
    session.winner = winner;
    await beginPhase(client, guild, session, settings, "RESULT");
    return;
  }

  if (phase === "DAY") {
    await beginPhase(client, guild, session, settings, "NIGHT");
  } else {
    session.round += 1;
    await beginPhase(client, guild, session, settings, "DAY");
  }
}

/**
 * The one entry point for every phase change - the scheduled deadline and a
 * manual skip both call this, and only one of them ever gets past the claim.
 *
 * @param {import('discord.js').Client} client
 * @param {string} lobbyChannelId
 * @param {{expectedPhase?: string}} [options]
 */
async function advancePhase(client, lobbyChannelId, { expectedPhase } = {}) {
  const current = await getSession(lobbyChannelId);
  if (!current) return;

  const fromPhase = current.phase;
  if (expectedPhase && fromPhase !== expectedPhase) return;
  if (fromPhase === "TRANSITIONING") return;

  const claimed = await claimPhaseTransition(lobbyChannelId, fromPhase);
  if (!claimed) return;

  const guild = await client.guilds.fetch(claimed.guild_id).catch(() => null);
  if (!guild) {
    await cleanupSession(client, claimed, null);
    return;
  }

  const settings = await getSettings(guild);

  if (fromPhase === "RECRUITMENT") return finishRecruitment(client, guild, claimed, settings);
  if (fromPhase === "DAY") return finishVotingPhase(client, guild, claimed, settings, "DAY");
  if (fromPhase === "NIGHT") return finishVotingPhase(client, guild, claimed, settings, "NIGHT");
  if (fromPhase === "RESULT") return cleanupSession(client, claimed, guild);
}

/* -------------------------------------------------------------- handlers */

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} settings
 */
async function handleJoin(interaction, settings) {
  const lobbyChannelId = interaction.customId.split(":")[1];
  const t = interactionTranslator(interaction, settings);
  const session = await getSession(lobbyChannelId);
  if (!session) return interaction.reply({ content: t("forestFuss.errors.notFound"), ephemeral: true });
  if (session.phase !== "RECRUITMENT")
    return interaction.reply({ content: t("forestFuss.errors.notRecruiting"), ephemeral: true });
  if (session.players.some((player) => player.user_id === interaction.user.id)) {
    return interaction.reply({ content: t("forestFuss.errors.alreadyJoined"), ephemeral: true });
  }
  if (session.players.length >= maxPlayers(settings)) {
    return interaction.reply({ content: t("forestFuss.errors.fullLobby"), ephemeral: true });
  }

  const elsewhere = await findSessionForMember(interaction.guildId, interaction.user.id);
  if (elsewhere) return interaction.reply({ content: t("forestFuss.alreadyInGame"), ephemeral: true });

  session.players.push({ user_id: interaction.user.id });
  await session.save();
  await interaction.deferUpdate().catch(() => {});
  await renderLobby(interaction.client, session, settings);
}

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} settings
 */
async function handleLeave(interaction, settings) {
  const lobbyChannelId = interaction.customId.split(":")[1];
  const t = interactionTranslator(interaction, settings);
  const session = await getSession(lobbyChannelId);
  if (!session) return interaction.reply({ content: t("forestFuss.errors.notFound"), ephemeral: true });
  if (session.phase !== "RECRUITMENT")
    return interaction.reply({ content: t("forestFuss.errors.notRecruiting"), ephemeral: true });
  if (session.leader_id === interaction.user.id) {
    return interaction.reply({ content: t("forestFuss.errors.leaderCannotLeave"), ephemeral: true });
  }

  const before = session.players.length;
  session.players = session.players.filter((player) => player.user_id !== interaction.user.id);
  if (session.players.length === before)
    return interaction.reply({ content: t("forestFuss.errors.notInGame"), ephemeral: true });

  await session.save();
  await interaction.deferUpdate().catch(() => {});
  await renderLobby(interaction.client, session, settings);
}

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} settings
 */
async function handleSkip(interaction, settings) {
  const lobbyChannelId = interaction.customId.split(":")[1];
  const t = interactionTranslator(interaction, settings);
  const session = await getSession(lobbyChannelId);
  if (!session) return interaction.reply({ content: t("forestFuss.errors.notFound"), ephemeral: true });
  if (!canControl(session, interaction.user.id, leadersOnly(settings))) {
    return interaction.reply({ content: t("forestFuss.errors.leaderOnly"), ephemeral: true });
  }
  if (session.phase === "RECRUITMENT" && session.players.length < MIN_PLAYERS) {
    return interaction.reply({
      content: t("forestFuss.errors.notEnoughPlayers", { min: MIN_PLAYERS }),
      ephemeral: true,
    });
  }

  await interaction.deferUpdate().catch(() => {});
  const phase = session.phase;
  await interaction.client.scheduler?.cancel({ dedupeKey: dedupeKey(lobbyChannelId) }).catch(() => {});
  await advancePhase(interaction.client, lobbyChannelId, { expectedPhase: phase });
}

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} settings
 */
async function handleStop(interaction, settings) {
  const lobbyChannelId = interaction.customId.split(":")[1];
  const t = interactionTranslator(interaction, settings);
  const session = await getSession(lobbyChannelId);
  if (!session) return interaction.reply({ content: t("forestFuss.errors.notFound"), ephemeral: true });
  if (!canControl(session, interaction.user.id, leadersOnly(settings))) {
    return interaction.reply({ content: t("forestFuss.errors.leaderOnly"), ephemeral: true });
  }

  await interaction.reply({ content: t("forestFuss.stopped"), ephemeral: true });
  await interaction.channel?.send(t("forestFuss.stopped")).catch(() => {});
  await cleanupSession(interaction.client, session, interaction.guild);
}

/**
 * @param {import('discord.js').StringSelectMenuInteraction} interaction
 * @param {object} settings
 */
async function handleVote(interaction, settings) {
  const lobbyChannelId = interaction.customId.split(":")[1];
  const t = interactionTranslator(interaction, settings);
  const session = await getSession(lobbyChannelId);
  if (!session) return interaction.reply({ content: t("forestFuss.errors.notFound"), ephemeral: true });

  const voter = session.players.find((player) => player.user_id === interaction.user.id);
  if (!voter || !voter.alive) return interaction.reply({ content: t("forestFuss.vote.notAlive"), ephemeral: true });

  if (session.phase === "NIGHT" && voter.role !== "WOLF") {
    return interaction.reply({ content: t("forestFuss.vote.notWolf"), ephemeral: true });
  }
  if (session.phase !== "DAY" && session.phase !== "NIGHT") {
    return interaction.reply({ content: t("forestFuss.vote.wrongPhase"), ephemeral: true });
  }

  const targetId = interaction.values[0];
  session.votes = session.votes.filter((vote) => vote.voter_id !== interaction.user.id);
  session.votes.push({ voter_id: interaction.user.id, target_id: targetId });
  await session.save();

  await interaction.reply({
    content: t("forestFuss.vote.recorded", { name: memberLabel(interaction.guild, targetId) }),
    ephemeral: true,
  });

  if (session.phase === "DAY") await renderLobby(interaction.client, session, settings).catch(() => {});

  const eligible =
    session.phase === "DAY"
      ? session.players.filter((player) => player.alive)
      : session.players.filter((player) => player.alive && player.role === "WOLF");
  const voted = new Set(session.votes.map((vote) => vote.voter_id));

  if (eligible.length && eligible.every((player) => voted.has(player.user_id))) {
    const phase = session.phase;
    await interaction.client.scheduler?.cancel({ dedupeKey: dedupeKey(lobbyChannelId) }).catch(() => {});
    await advancePhase(interaction.client, lobbyChannelId, { expectedPhase: phase });
  }
}

/**
 * @param {object} payload
 * @param {{client: import('discord.js').Client}} context
 */
async function handleScheduledPhaseEnd(payload, { client }) {
  await advancePhase(client, payload.lobbyChannelId, { expectedPhase: payload.phase });
}

/**
 * @param {import('@src/services/scheduler/Scheduler').Scheduler} scheduler
 */
function register(scheduler) {
  scheduler.register(TASK_TYPE, handleScheduledPhaseEnd);
  return scheduler;
}

module.exports = {
  PREFIX_JOIN,
  PREFIX_LEAVE,
  PREFIX_SKIP,
  PREFIX_STOP,
  PREFIX_VOTE,
  TASK_TYPE,
  advancePhase,
  handleJoin,
  handleLeave,
  handleScheduledPhaseEnd,
  handleSkip,
  handleStop,
  handleVote,
  register,
  startSession,
};
