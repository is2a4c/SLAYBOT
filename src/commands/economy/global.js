const { ApplicationCommandOptionType } = require("discord.js");
const { EcosystemService } = require("@src/services/ecosystem/EcosystemService");
const { leaderboardEmbed, profileEmbed, rewardEmbed, seasonEmbed } = require("@src/services/ecosystem/presenter");

const service = new EcosystemService();
const leaderboardTypes = ["players", "servers", "wealth"];

module.exports = {
  name: "global",
  description: "global profile, economy and interserver competitions",
  category: "ECONOMY",
  botPermissions: ["EmbedLinks"],
  command: {
    enabled: true,
    minArgsCount: 1,
    subcommands: [
      { trigger: "profile [user]", description: "show a global ecosystem profile" },
      {
        trigger: "leaderboard <players|servers|wealth>",
        description: "show a global player, server or wealth leaderboard",
      },
      { trigger: "season", description: "show the current interserver season" },
      { trigger: "rewards", description: "preview your completed season rewards" },
      { trigger: "claim", description: "claim your completed season rewards" },
    ],
  },
  slashCommand: {
    enabled: true,
    options: [
      {
        name: "profile",
        description: "show a global ecosystem profile",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "user",
            description: "user whose profile should be shown",
            type: ApplicationCommandOptionType.User,
            required: false,
          },
        ],
      },
      {
        name: "leaderboard",
        description: "show a global leaderboard",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "type",
            description: "leaderboard type",
            type: ApplicationCommandOptionType.String,
            required: true,
            choices: leaderboardTypes.map((type) => ({ name: type, value: type })),
          },
        ],
      },
      {
        name: "season",
        description: "show the current interserver season",
        type: ApplicationCommandOptionType.Subcommand,
      },
      {
        name: "rewards",
        description: "preview your completed season rewards",
        type: ApplicationCommandOptionType.Subcommand,
      },
      {
        name: "claim",
        description: "claim your completed season rewards",
        type: ApplicationCommandOptionType.Subcommand,
      },
    ],
  },

  async messageRun(message, args) {
    const subcommand = args[0]?.toLowerCase();
    const response = await execute({
      subcommand,
      type: args[1]?.toLowerCase(),
      user: await resolvePrefixUser(message, subcommand === "profile" ? args[1] : null),
      client: message.client,
      requester: message.author,
    });
    await message.safeReply(response);
  },

  async interactionRun(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const response = await execute({
      subcommand,
      type: interaction.options.getString("type"),
      user: interaction.options.getUser("user") || interaction.user,
      client: interaction.client,
      requester: interaction.user,
    });
    await interaction.followUp(response);
  },
};

async function resolvePrefixUser(message, input) {
  if (!input) return message.author;
  const member = await message.guild.resolveMember(input);
  return member?.user || null;
}

async function execute({ subcommand, type, user, client, requester }) {
  if (subcommand === "profile") {
    if (!user) return "Provide a valid user whose global profile should be shown";
    return { embeds: [profileEmbed(user, await service.getProfile(user.id))] };
  }
  if (subcommand === "leaderboard") {
    if (!leaderboardTypes.includes(type)) {
      return "Choose a leaderboard type: `players`, `servers`, or `wealth`";
    }
    const rows = await service.getLeaderboard(type);
    const result = await leaderboardEmbed(type, rows, client, requester);
    return typeof result === "string" ? result : { embeds: [result] };
  }
  if (subcommand === "season") return { embeds: [seasonEmbed()] };
  if (subcommand === "rewards") {
    return { embeds: [rewardEmbed(await service.getRewardPreview(requester.id))] };
  }
  if (subcommand === "claim") {
    const result = await service.claimPreviousSeason(requester.id);
    return { embeds: [rewardEmbed(result.preview, result)] };
  }
  return "Choose a subcommand: `profile`, `leaderboard`, `season`, `rewards`, or `claim`";
}

module.exports.execute = execute;
