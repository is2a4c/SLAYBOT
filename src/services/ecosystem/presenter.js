const { EmbedBuilder, escapeMarkdown } = require("discord.js");
const { EMBED_COLORS, ECONOMY } = require("@root/config");
const { getSeasonWindow } = require("./EcosystemService");

function profileEmbed(user, profile) {
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLORS.BOT_EMBED)
    .setAuthor({
      name: `Global profile · ${user.username}`,
      iconURL: user.displayAvatarURL(),
    })
    .addFields(
      { name: "Season", value: profile.seasonId, inline: true },
      { name: "Points", value: profile.points.toLocaleString("en-US"), inline: true },
      { name: "Messages", value: profile.messages.toLocaleString("en-US"), inline: true },
      {
        name: "Global wallet",
        value: `${profile.coins.toLocaleString("en-US")}${ECONOMY.CURRENCY}`,
        inline: true,
      },
      {
        name: "Global bank",
        value: `${profile.bank.toLocaleString("en-US")}${ECONOMY.CURRENCY}`,
        inline: true,
      },
      {
        name: "Net worth",
        value: `${profile.netWorth.toLocaleString("en-US")}${ECONOMY.CURRENCY}`,
        inline: true,
      }
    );

  if (profile.titles.length) {
    embed.addFields({
      name: "Earned titles",
      value: profile.titles.map((title) => `🏆 ${title.label}`).join("\n"),
    });
  }
  return embed;
}

async function leaderboardEmbed(type, rows, client, requester) {
  if (!rows.length) return `There are no entries in the global ${type} leaderboard yet`;

  const labels = await Promise.all(rows.map((row) => resolveLabel(type, row.id, client)));
  const description = rows
    .map((row, index) => {
      const value =
        type === "wealth"
          ? `${row.netWorth.toLocaleString("en-US")}${ECONOMY.CURRENCY}`
          : `${row.points.toLocaleString("en-US")} points`;
      return `**#${index + 1}** · ${labels[index]} — **${value}**`;
    })
    .join("\n");

  const title = {
    players: "Global player leaderboard",
    servers: "Interserver season",
    wealth: "Global wealth leaderboard",
  }[type];

  return new EmbedBuilder()
    .setColor(EMBED_COLORS.BOT_EMBED)
    .setAuthor({ name: title })
    .setDescription(description)
    .setFooter({ text: `Requested by ${requester.username}` });
}

async function resolveLabel(type, id, client) {
  if (type === "servers") {
    const guild = client.guilds.cache.get(id);
    return escapeMarkdown(guild?.name || `Server ${id}`);
  }

  const cached = client.users.cache.get(id);
  if (cached) return escapeMarkdown(cached.username);
  const user = await client.users.fetch(id).catch(() => null);
  return escapeMarkdown(user?.username || `User ${id}`);
}

function seasonEmbed(at = new Date()) {
  const season = getSeasonWindow(at);
  return new EmbedBuilder()
    .setColor(EMBED_COLORS.BOT_EMBED)
    .setAuthor({ name: `Global season ${season.id}` })
    .setDescription(
      "Earn season points through XP from genuine messages. AutoMod removals, commands and XP-cooldown messages do not count.\n\n" +
        "**What you fight for**\n" +
        "🥇 #1: 25,000 coins · #2: 15,000 · #3: 10,000 · #4–10: 5,000\n" +
        "🎯 500 / 2,000 / 7,500 points: 500 / 2,000 / 7,500 coins\n" +
        "🏰 Champion server contributors: 5,000 coins\n" +
        "Every achievement also unlocks a permanent global title."
    )
    .addFields(
      { name: "Starts", value: `<t:${Math.floor(season.startsAt.getTime() / 1000)}:F>`, inline: true },
      { name: "Ends", value: `<t:${Math.floor(season.endsAt.getTime() / 1000)}:F>`, inline: true }
    );
}

function rewardEmbed(preview, claimResult) {
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLORS.BOT_EMBED)
    .setAuthor({ name: `Season rewards · ${preview.seasonId}` })
    .addFields(
      { name: "Season points", value: preview.points.toLocaleString("en-US"), inline: true },
      { name: "Global rank", value: preview.playerRank ? `#${preview.playerRank}` : "Outside top 10", inline: true },
      {
        name: "Total reward",
        value: `${preview.amount.toLocaleString("en-US")}${ECONOMY.CURRENCY}`,
        inline: true,
      }
    );

  if (preview.breakdown.length) {
    embed.setDescription(
      preview.breakdown
        .map((item) => `• ${item.label}: **${item.amount.toLocaleString("en-US")}${ECONOMY.CURRENCY}**`)
        .join("\n")
    );
  } else {
    embed.setDescription("No reward was earned in this completed season.");
  }

  if (claimResult?.claimed) {
    embed.setFooter({ text: `Claimed successfully · Bank balance: ${claimResult.bank.toLocaleString("en-US")}` });
  } else if (claimResult?.reason === "ALREADY_CLAIMED") {
    embed.setFooter({ text: "This season reward has already been claimed." });
  } else if (claimResult?.reason === "NO_REWARD") {
    embed.setFooter({ text: "Reach a milestone or leaderboard position in the next season." });
  } else if (preview.amount > 0) {
    embed.setFooter({ text: "Use /global claim to move this reward into your global bank." });
  }

  return embed;
}

module.exports = { leaderboardEmbed, profileEmbed, rewardEmbed, seasonEmbed };
