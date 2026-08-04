const { commandHandler, automodHandler, statsHandler, stickyHandler, modmailHandler } = require("@src/handlers");
const { PREFIX_COMMANDS } = require("@root/config");
const { getSettings } = require("@schemas/Guild");

/**
 * @param {import('@src/structures').BotClient} client
 * @param {import('discord.js').Message} message
 */
module.exports = async (client, message) => {
  if (message.author.bot) return;

  // Direct messages are modmail, not commands
  if (!message.guild) {
    return modmailHandler.handleDirectMessage(message).catch((ex) => client.logger.error("modmail: DM", ex));
  }

  const settings = await getSettings(message.guild);
  const messageContent = message.content || "";
  client.telemetry?.record("messages", {
    guildId: message.guildId,
    userId: message.author.id,
    at: message.createdAt,
  });

  // command handler
  let isCommand = false;
  const startsWithPrefix = PREFIX_COMMANDS.enabled && messageContent.startsWith(settings.prefix);
  if (PREFIX_COMMANDS.enabled) {
    // Answer only a real mention of the bot. Matching the bare id matched any
    // message that merely contained it — a link to the bot, somebody quoting its
    // id — and the bot announced its prefix into the middle of the conversation.
    if (new RegExp(`<@!?${client.user.id}>`).test(messageContent)) {
      message.channel.safeSend(`> My prefix is \`${settings.prefix}\``);
    }

    if (startsWithPrefix) {
      const invoke = messageContent.slice(settings.prefix.length).trim().split(/\s+/)[0];
      const cmd = client.getCommand(invoke);
      if (cmd) {
        isCommand = true;
        await commandHandler.handlePrefixCommand(message, cmd, settings);
      }
    }
  }

  let skipXp = false;

  // if not a known command, run automod before stats to avoid rewarding removable messages
  if (!isCommand) {
    const automodResult = await automodHandler.performAutomod(message, settings);
    skipXp = Boolean(automodResult?.triggered);
    if (automodResult?.triggered || automodResult?.shadowTriggered) {
      client.telemetry?.recordAutomod({
        guildId: message.guildId,
        userId: message.author.id,
        deleted: automodResult.deleted,
        strikes: automodResult.strikes,
      });
    }

    // Don't reward command-like noise such as unknown prefix invocations.
    if (startsWithPrefix) skipXp = true;
  }

  // sticky messages - keep the pinned-style message at the bottom of the channel
  stickyHandler.handleMessage(message, settings).catch((ex) => client.logger.error("stickyMessages", ex));

  // modmail - staff replies typed directly into a modmail thread
  if (!isCommand && message.channel.isThread()) {
    modmailHandler.handleStaffMessage(message, settings).catch((ex) => client.logger.error("modmail: staff", ex));
  }

  // stats handler
  if (settings.stats.enabled) {
    await statsHandler.trackMessageStats(message, isCommand, settings, { skipXp });
  }
};
