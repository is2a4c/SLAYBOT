const { commandHandler, automodHandler, statsHandler } = require("@src/handlers");
const { PREFIX_COMMANDS } = require("@root/config");
const { getSettings } = require("@schemas/Guild");

/**
 * @param {import('@src/structures').BotClient} client
 * @param {import('discord.js').Message} message
 */
module.exports = async (client, message) => {
  if (!message.guild || message.author.bot) return;
  const settings = await getSettings(message.guild);
  const messageContent = message.content || "";

  // command handler
  let isCommand = false;
  const startsWithPrefix = PREFIX_COMMANDS.enabled && messageContent.startsWith(settings.prefix);
  if (PREFIX_COMMANDS.enabled) {
    // check for bot mentions
    if (messageContent.includes(`${client.user.id}`)) {
      message.channel.safeSend(`> My prefix is \`${settings.prefix}\``);
    }

    if (startsWithPrefix) {
      const invoke = messageContent.slice(settings.prefix.length).trim().split(/\s+/)[0];
      const cmd = client.getCommand(invoke);
      if (cmd) {
        isCommand = true;
        commandHandler.handlePrefixCommand(message, cmd, settings);
      }
    }
  }

  let skipXp = false;

  // if not a known command, run automod before stats to avoid rewarding removable messages
  if (!isCommand) {
    const automodResult = await automodHandler.performAutomod(message, settings);
    skipXp = Boolean(automodResult?.triggered);

    // Don't reward command-like noise such as unknown prefix invocations.
    if (startsWithPrefix) skipXp = true;
  }

  // stats handler
  if (settings.stats.enabled) {
    await statsHandler.trackMessageStats(message, isCommand, settings, { skipXp });
  }
};
