const { EmbedBuilder } = require("discord.js");
const { getSettings } = require("@schemas/Guild");
const { deleteGuildTasks } = require("@schemas/ScheduledTask");
const { deleteGuildPanels } = require("@schemas/SelfRolePanel");
const { deleteGuildBirthdays } = require("@schemas/Birthday");
const { deleteGuildPolls } = require("@schemas/Poll");
const { deleteGuildChallenges } = require("@schemas/VerificationAttempt");
const { deleteGuildThreads } = require("@schemas/ModmailThread");
const { deleteGuildFeeds } = require("@schemas/Feed");
const { deleteGuildBackups } = require("@schemas/GuildBackup");
const { deleteGuildEntries } = require("@schemas/StarboardEntry");
const { deleteGuildStickies } = require("@schemas/StickyMessage");
const { deleteGuildChannels: deleteGuildTempVoice } = require("@schemas/TempVoiceChannel");

/**
 * @param {import('@src/structures').BotClient} client
 * @param {import('discord.js').Guild} guild
 */
module.exports = async (client, guild) => {
  if (client.smartInvites) await client.smartInvites.handleGuildDeleted(guild.id);
  if (!guild.available) return;
  client.logger.log(`Guild Left: ${guild.name} Members: ${guild.memberCount}`);
  client.telemetry?.record("guild_leaves", { guildId: guild.id });

  const settings = await getSettings(guild);
  settings.data.leftAt = new Date();
  await settings.save();

  // Nothing left to fire for a guild the bot is no longer in
  await Promise.all([
    deleteGuildTasks(guild.id).catch((error) => client.logger.error(`Failed to clear tasks for ${guild.id}`, error)),
    deleteGuildPanels(guild.id).catch((error) => client.logger.error(`Failed to clear panels for ${guild.id}`, error)),
    deleteGuildEntries(guild.id).catch((error) =>
      client.logger.error(`Failed to clear starboard entries for ${guild.id}`, error)
    ),
    deleteGuildStickies(guild.id).catch((error) =>
      client.logger.error(`Failed to clear sticky messages for ${guild.id}`, error)
    ),
    deleteGuildBirthdays(guild.id).catch((error) =>
      client.logger.error(`Failed to clear birthdays for ${guild.id}`, error)
    ),
    deleteGuildPolls(guild.id).catch((error) => client.logger.error(`Failed to clear polls for ${guild.id}`, error)),
    deleteGuildChallenges(guild.id).catch((error) =>
      client.logger.error(`Failed to clear verification challenges for ${guild.id}`, error)
    ),
    deleteGuildThreads(guild.id).catch((error) =>
      client.logger.error(`Failed to clear modmail threads for ${guild.id}`, error)
    ),
    deleteGuildFeeds(guild.id).catch((error) => client.logger.error(`Failed to clear feeds for ${guild.id}`, error)),
    deleteGuildBackups(guild.id).catch((error) =>
      client.logger.error(`Failed to clear backups for ${guild.id}`, error)
    ),
    deleteGuildTempVoice(guild.id).catch((error) =>
      client.logger.error(`Failed to clear temp voice channels for ${guild.id}`, error)
    ),
  ]);

  if (!client.botLogChannelId && !client.joinLeaveWebhook) return;

  let ownerTag;
  const ownerId = guild.ownerId || settings.data.owner;
  try {
    const owner = await client.users.fetch(ownerId);
    ownerTag = owner.globalName || owner.username;
  } catch (err) {
    ownerTag = "Deleted User";
  }

  const embed = new EmbedBuilder()
    .setTitle("Guild Left")
    .setThumbnail(guild.iconURL())
    .setColor(client.config.EMBED_COLORS.ERROR)
    .addFields(
      {
        name: "Guild Name",
        value: guild.name || "NA",
        inline: false,
      },
      {
        name: "ID",
        value: guild.id,
        inline: false,
      },
      {
        name: "Owner",
        value: `${ownerTag} [\`${ownerId}\`]`,
        inline: false,
      },
      {
        name: "Members",
        value: `\`\`\`yaml\n${guild.memberCount}\`\`\``,
        inline: false,
      }
    )
    .setFooter({ text: `Guild #${client.guilds.cache.size}` });

  await client
    .sendGuildLog({ embeds: [embed] })
    .catch((error) => client.logger.error(`Failed to send guild leave webhook for ${guild.id}`, error));
};
