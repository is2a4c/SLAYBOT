const { ApplicationCommandOptionType } = require("discord.js");

/**
 * @type {import("@structures/Command")}
 */
module.exports = {
  name: "leaveserver",
  description: "leave a server.",
  category: "OWNER",
  botPermissions: ["EmbedLinks"],
  command: {
    enabled: true,
    minArgsCount: 1,
    usage: "<serverId>",
  },
  slashCommand: {
    enabled: true,
    ephemeral: true,
    options: [
      {
        name: "server-id",
        description: "ID of the server the bot should leave",
        type: ApplicationCommandOptionType.String,
        required: true,
      },
    ],
  },

  async messageRun(message, args, data) {
    const response = await leaveServer(message.client, args[0], data.prefix);
    return message.safeReply(response);
  },

  async interactionRun(interaction) {
    const response = await leaveServer(interaction.client, interaction.options.getString("server-id"));
    return interaction.safeFollowUp(response);
  },
};

async function leaveServer(client, serverId, prefix = "!") {
  if (!/^\d{17,20}$/.test(String(serverId || ""))) {
    return `No server found. Provide a valid server ID. Use ${prefix}listservers to find it.`;
  }

  const guild = client.guilds.cache.get(serverId);
  if (!guild) {
    return `No server found. Provide a valid server ID. Use ${prefix}listservers to find it.`;
  }

  const name = guild.name;
  try {
    await guild.leave();
    return `Successfully left \`${name}\` (\`${serverId}\`).`;
  } catch (error) {
    client.logger.error("GuildLeave", error);
    return `Failed to leave \`${name}\` (\`${serverId}\`).`;
  }
}

module.exports.leaveServer = leaveServer;
