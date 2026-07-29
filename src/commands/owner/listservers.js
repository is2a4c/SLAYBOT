const {
  EmbedBuilder,
  ButtonBuilder,
  ActionRowBuilder,
  ButtonStyle,
  ComponentType,
  ApplicationCommandOptionType,
} = require("discord.js");
const { getSettings } = require("@schemas/Guild");

const IDLE_TIMEOUT = 30; // in seconds
const MAX_PER_PAGE = 10; // max number of embed fields per page

module.exports = {
  name: "listservers",
  description: "lists all/matching servers",
  category: "OWNER",
  botPermissions: ["EmbedLinks"],
  command: {
    enabled: true,
    aliases: ["listserver", "findserver", "findservers"],
    usage: "[match]",
  },
  slashCommand: {
    enabled: true,
    ephemeral: true,
    options: [
      {
        name: "match",
        description: "optional server ID or part of a server name",
        type: ApplicationCommandOptionType.String,
        required: false,
      },
    ],
  },

  async messageRun(message, args) {
    return sendServerList({
      client: message.client,
      userId: message.author.id,
      match: args.join(" ") || null,
      send: (payload) => message.channel.send(payload),
    });
  },

  async interactionRun(interaction) {
    return sendServerList({
      client: interaction.client,
      userId: interaction.user.id,
      match: interaction.options.getString("match"),
      send: (payload) => interaction.editReply(payload),
    });
  },
};

function selectServers(client, match) {
  if (!match) return Array.from(client.guilds.cache.values());

  const matched = new Map();
  if (client.guilds.cache.has(match)) {
    const exact = client.guilds.cache.get(match);
    matched.set(exact.id, exact);
  }
  client.guilds.cache
    .filter((guild) => guild.name.toLowerCase().includes(match.toLowerCase()))
    .forEach((guild) => matched.set(guild.id, guild));
  return [...matched.values()];
}

async function sendServerList({ client, userId, match, send, settingsLoader = getSettings }) {
  const servers = selectServers(client, match);
  const total = servers.length;
  const maxPerPage = MAX_PER_PAGE;
  const totalPages = Math.ceil(total / maxPerPage);

  if (totalPages === 0) return send({ content: "No servers found", embeds: [], components: [] });
  let currentPage = 1;

  const buildEmbed = async () => {
    const start = (currentPage - 1) * maxPerPage;
    const end = start + maxPerPage < total ? start + maxPerPage : total;

    const embed = new EmbedBuilder()
      .setColor(client.config.EMBED_COLORS.BOT_EMBED)
      .setAuthor({ name: "📋 Список серверов" })
      .setFooter({
        text: `${match ? "Найдено" : "Всего"} серверов: ${total} • Страница ${currentPage}/${totalPages}`,
      });

    let description = "";
    for (let i = start; i < end; i++) {
      const server = servers[i];
      const owner = client.users.cache.get(server.ownerId);
      const botsCount = server.members.cache.filter((m) => m.user.bot).size;

      const settings = await settingsLoader(server).catch(() => null);

      const inviteUrl = settings?.data?.inviteUrl;

      description += `**${server.name}** \`(${server.id})\`\n`;
      description += `👑 ${owner ? owner.username : server.ownerId}\n`;
      description += `👥 ${server.memberCount} (ботов: ${botsCount})\n`;
      description += `📅 <t:${Math.floor(server.createdTimestamp / 1000)}:d>\n`;
      if (inviteUrl) description += `🔗 ${inviteUrl}\n`;
      description += `───────────────\n`;
    }

    embed.setDescription(description || "Нет серверов");

    const buttonsRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("prevBtn")
        .setEmoji("⬅️")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(currentPage === 1),
      new ButtonBuilder()
        .setCustomId("nxtBtn")
        .setEmoji("➡️")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(currentPage === totalPages)
    );

    return { embed, buttonsRow };
  };

  const { embed, buttonsRow } = await buildEmbed();
  const sentMsg = await send({ embeds: [embed], components: [buttonsRow] });

  // Collector
  const collector = sentMsg.createMessageComponentCollector({
    filter: (reaction) => reaction.user.id === userId,
    idle: IDLE_TIMEOUT * 1000,
    dispose: true,
    componentType: ComponentType.Button,
  });

  collector.on("collect", async (response) => {
    if (!["prevBtn", "nxtBtn"].includes(response.customId)) return;
    await response.deferUpdate();

    if (response.customId === "prevBtn" && currentPage > 1) {
      currentPage--;
    } else if (response.customId === "nxtBtn" && currentPage < totalPages) {
      currentPage++;
    }

    const { embed, buttonsRow } = await buildEmbed();
    await sentMsg.edit({ embeds: [embed], components: [buttonsRow] });
  });

  collector.on("end", async () => {
    await sentMsg.edit({ components: [] }).catch(() => {});
  });
}

module.exports.selectServers = selectServers;
module.exports.sendServerList = sendServerList;
