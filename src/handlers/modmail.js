const { ChannelType, EmbedBuilder, PermissionFlagsBits } = require("discord.js");
const { EMBED_COLORS } = require("@root/config");
const { closeThread, createThread, getOpenThread, getThreadById, isBlocked } = require("@schemas/ModmailThread");

const CHANNEL_PERMISSIONS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.CreatePrivateThreads,
  PermissionFlagsBits.SendMessagesInThreads,
];

const MAX_CONTENT = 3900;

function resolveArchiveDuration(guild, configured) {
  const duration = Number(configured) || 1440;
  if (duration === 10080 && !guild.features?.includes("SEVEN_DAY_THREAD_ARCHIVE")) return 1440;
  if (duration === 4320 && !guild.features?.includes("THREE_DAY_THREAD_ARCHIVE")) return 1440;
  return [60, 1440, 4320, 10080].includes(duration) ? duration : 1440;
}

/**
 * Which guild a DM should open a thread in.
 *
 * A member can share several servers with the bot, so the choice must be
 * unambiguous: exactly one shared guild with modmail enabled.
 *
 * @param {{guilds: Array<{id: string, enabled: boolean}>}} input
 * @returns {{guildId: string|null, error: string|null}}
 */
function resolveTargetGuild({ guilds }) {
  const available = (guilds || []).filter((guild) => guild.enabled);

  if (available.length === 0) {
    return { guildId: null, error: "None of the servers we share have modmail enabled." };
  }
  if (available.length > 1) {
    return {
      guildId: null,
      error:
        "We share several servers with modmail. Use `/modmail contact` in the server you want to reach so I know where to open the thread.",
    };
  }

  return { guildId: available[0].id, error: null };
}

/**
 * @param {import('discord.js').User} user
 * @param {import('discord.js').Message} message
 */
function buildIncomingEmbed(user, message, config = {}) {
  const embed = new EmbedBuilder()
    .setColor(config.incoming_color || EMBED_COLORS.BOT_EMBED)
    .setAuthor({
      name: `${user.globalName || user.username} · ${user.id}`,
      iconURL: user.displayAvatarURL() || undefined,
    })
    .setDescription(message.content?.slice(0, MAX_CONTENT) || "_no text_")
    .setTimestamp();

  const attachments = [...message.attachments.values()];
  if (attachments.length && config.show_attachments !== false) {
    embed.addFields({
      name: "Attachments",
      value: attachments
        .map((attachment) => `[${attachment.name}](${attachment.url})`)
        .join("\n")
        .slice(0, 1024),
    });
  }

  return embed;
}

/**
 * @param {import('discord.js').Guild} guild
 * @param {string} staffName
 * @param {string} content
 */
function buildReplyEmbed(guild, staffName, content, anonymous, config = {}) {
  return new EmbedBuilder()
    .setColor(config.reply_color || EMBED_COLORS.SUCCESS)
    .setAuthor({
      name: anonymous ? `${guild.name} staff` : `${staffName} · ${guild.name}`,
      iconURL: guild.iconURL() || undefined,
    })
    .setDescription(content.slice(0, MAX_CONTENT))
    .setTimestamp();
}

/**
 * Open (or reuse) the private thread that mirrors a member's DMs.
 * @param {{guild: import('discord.js').Guild, user: import('discord.js').User, settings: object}} input
 */
async function ensureThread({ guild, user, settings }) {
  const config = settings.modmail;
  const channel = guild.channels.cache.get(config.channel_id);
  if (!channel || channel.type !== ChannelType.GuildText) {
    return { thread: null, error: "The modmail channel is missing. Ask an admin to run `/modmail setup` again." };
  }

  if (!channel.permissionsFor(guild.members.me)?.has(CHANNEL_PERMISSIONS)) {
    return { thread: null, error: "I am missing permissions in the modmail channel." };
  }

  const existing = await getOpenThread(guild.id, user.id);
  if (existing) {
    const thread = await guild.channels.fetch(existing.thread_id).catch(() => null);
    if (thread && !thread.archived) return { thread, record: existing, error: null };

    if (thread?.archived) {
      await thread.setArchived(false).catch(() => {});
      return { thread, record: existing, error: null };
    }

    // The thread was deleted: close the record and start over.
    await closeThread({ guildId: guild.id, threadId: existing.thread_id, closedBy: null, reason: "thread deleted" });
  }

  const threadName = String(config.thread_name_template || "{username}-{id4}")
    .replace(/{username}/g, user.username)
    .replace(/{name}/g, user.globalName || user.username)
    .replace(/{id}/g, user.id)
    .replace(/{id4}/g, user.id.slice(-4))
    .slice(0, 100);
  const thread = await channel.threads
    .create({
      name: threadName || `${user.username}-${user.id.slice(-4)}`,
      type: ChannelType.PrivateThread,
      invitable: false,
      autoArchiveDuration: resolveArchiveDuration(guild, config.archive_duration_minutes),
      reason: `Modmail thread for ${user.id}`,
    })
    .catch(() => null);

  if (!thread) return { thread: null, error: "I could not create the modmail thread." };

  const record = await createThread({ guildId: guild.id, userId: user.id, threadId: thread.id });

  const intro = new EmbedBuilder()
    .setColor(config.intro_color || EMBED_COLORS.BOT_EMBED)
    .setAuthor({ name: `${user.globalName || user.username} · ${user.id}`, iconURL: user.displayAvatarURL() })
    .setDescription(
      [
        String(
          config.intro_message ||
            "New modmail thread. Reply with `/modmail reply` or type here when reply mirroring is enabled."
        )
          .replace(/{member}/g, user.toString())
          .replace(/{username}/g, user.username)
          .replace(/{id}/g, user.id)
          .replace(/{server}/g, guild.name)
          .slice(0, 1000),
        `**Member:** ${user} \`${user.id}\``,
        `**Account created:** <t:${Math.floor(user.createdTimestamp / 1000)}:R>`,
      ].join("\n")
    );

  const mentions =
    config.mention_staff === false ? "" : (config.staff_roles || []).map((roleId) => `<@&${roleId}>`).join(" ");
  await thread.send({ content: mentions || undefined, embeds: [intro] }).catch(() => {});

  return { thread, record, error: null };
}

module.exports = {
  MAX_CONTENT,
  buildIncomingEmbed,
  buildReplyEmbed,
  ensureThread,
  resolveArchiveDuration,
  resolveTargetGuild,

  /**
   * A direct message from a member: mirror it into the staff thread.
   * @param {import('discord.js').Message} message
   */
  async handleDirectMessage(message) {
    const client = message.client;
    const { getSettings } = require("@schemas/Guild");

    // Settings first (they are cached), membership second: fetching a member in
    // every shared guild would be a lot of REST calls for nothing.
    const shared = [];
    for (const guild of client.guilds.cache.values()) {
      const settings = await getSettings(guild).catch(() => null);
      if (!settings?.modmail?.enabled || !settings.modmail.channel_id) continue;

      const member =
        guild.members.cache.get(message.author.id) || (await guild.members.fetch(message.author.id).catch(() => null));
      if (!member) continue;

      shared.push({ id: guild.id, guild, settings, enabled: true });
    }

    const { guildId, error } = resolveTargetGuild({ guilds: shared });
    if (!guildId) {
      // Stay quiet unless at least one shared guild could have handled it.
      if (shared.some((entry) => entry.enabled)) await message.reply(error).catch(() => {});
      return;
    }

    const target = shared.find((entry) => entry.id === guildId);

    if (await isBlocked(guildId, message.author.id)) {
      await message.reply("You cannot open a modmail thread on that server.").catch(() => {});
      return;
    }

    const {
      thread,
      record,
      error: threadError,
    } = await ensureThread({
      guild: target.guild,
      user: message.author,
      settings: target.settings,
    });

    if (!thread) {
      await message.reply(threadError).catch(() => {});
      return;
    }

    await thread
      .send({ embeds: [buildIncomingEmbed(message.author, message, target.settings.modmail)] })
      .catch(() => {});

    if (record) {
      record.last_user_message_at = new Date();
      record.messages += 1;
      await record.save().catch(() => {});
    }

    if (target.settings.modmail.member_ack_emoji) {
      await message.react(target.settings.modmail.member_ack_emoji).catch(() => {});
    }
  },

  /**
   * Staff message inside a modmail thread: forward it to the member.
   * @param {import('discord.js').Message} message
   * @param {object} settings
   */
  async handleStaffMessage(message, settings) {
    if (!settings.modmail?.enabled || !settings.modmail.mirror_replies) return;
    if (!message.channel.isThread()) return;
    if (message.channel.parentId !== settings.modmail.channel_id) return;
    // A leading dot marks an internal note that is not forwarded.
    const notePrefix = settings.modmail.internal_note_prefix ?? ".";
    if (notePrefix && message.content.startsWith(notePrefix)) return;

    const record = await getThreadById(message.guildId, message.channelId);
    if (!record?.open) return;

    const user = await message.client.users.fetch(record.user_id).catch(() => null);
    if (!user) return;

    const sent = await user
      .send({
        embeds: [
          buildReplyEmbed(
            message.guild,
            message.member?.displayName || message.author.username,
            message.content || "_no text_",
            settings.modmail.anonymous,
            settings.modmail
          ),
        ],
      })
      .catch(() => null);

    if (!sent) {
      await message.reply("I could not deliver that: the member has DMs closed.").catch(() => {});
      return;
    }

    record.last_staff_message_at = new Date();
    record.messages += 1;
    await record.save().catch(() => {});
    if (settings.modmail.staff_ack_emoji) {
      await message.react(settings.modmail.staff_ack_emoji).catch(() => {});
    }
  },
};
