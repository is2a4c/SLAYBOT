const { ApplicationCommandOptionType, ChannelType, EmbedBuilder, PermissionFlagsBits } = require("discord.js");
const { EMBED_COLORS } = require("@root/config");
const { tempVoiceHandler } = require("@src/handlers");
const { guildTranslator } = require("@src/i18n");
const { listGuildChannels } = require("@schemas/TempVoiceChannel");

const DEFAULT_HUB_NAME = "➕ Create channel";

/**
 * @type {import("@structures/Command")}
 */
module.exports = {
  name: "tempvoice",
  description: "give members a voice channel of their own with a button panel",
  category: "ADMIN",
  userPermissions: ["ManageGuild"],
  botPermissions: ["ManageChannels", "MoveMembers", "EmbedLinks"],
  command: {
    enabled: true,
    aliases: ["tempvc", "voicehub"],
    usage: "<setup|panel|status|off> ...",
    minArgsCount: 1,
    subcommands: [
      { trigger: "setup <#panel-channel>", description: "turn temp voice on and post the panel" },
      { trigger: "panel <#channel>", description: "post the control panel again" },
      { trigger: "status", description: "show the temp voice configuration" },
      { trigger: "off", description: "turn temp voice off" },
    ],
  },
  slashCommand: {
    enabled: true,
    ephemeral: true,
    options: [
      {
        name: "setup",
        description: "turn temp voice on and post the control panel",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "panel_channel",
            description: "text channel holding the button panel",
            type: ApplicationCommandOptionType.Channel,
            channelTypes: [ChannelType.GuildText],
            required: true,
          },
          {
            name: "hub_channel",
            description: "voice channel members join to get their own; created for you if left out",
            type: ApplicationCommandOptionType.Channel,
            channelTypes: [ChannelType.GuildVoice],
            required: false,
          },
          {
            name: "category",
            description: "category the personal channels are created in",
            type: ApplicationCommandOptionType.Channel,
            channelTypes: [ChannelType.GuildCategory],
            required: false,
          },
        ],
      },
      {
        name: "panel",
        description: "post the control panel again",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "channel",
            description: "channel the panel is posted in",
            type: ApplicationCommandOptionType.Channel,
            channelTypes: [ChannelType.GuildText],
            required: true,
          },
        ],
      },
      {
        name: "config",
        description: "change how personal channels are created",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "name_template",
            description: "name of a new channel; {user} and {count} are filled in",
            type: ApplicationCommandOptionType.String,
            required: false,
          },
          {
            name: "limit",
            description: "member limit new channels start with (0 for no limit)",
            type: ApplicationCommandOptionType.Integer,
            required: false,
            minValue: 0,
            maxValue: 99,
          },
          {
            name: "locked",
            description: "new channels start closed to everyone but their owner",
            type: ApplicationCommandOptionType.Boolean,
            required: false,
          },
          {
            name: "max_per_member",
            description: "how many channels one member may own at a time",
            type: ApplicationCommandOptionType.Integer,
            required: false,
            minValue: 1,
            maxValue: 5,
          },
          {
            name: "claimable",
            description: "let somebody still inside take over a channel its owner left",
            type: ApplicationCommandOptionType.Boolean,
            required: false,
          },
          {
            name: "category",
            description: "category the personal channels are created in",
            type: ApplicationCommandOptionType.Channel,
            channelTypes: [ChannelType.GuildCategory],
            required: false,
          },
        ],
      },
      {
        name: "status",
        description: "show the temp voice configuration",
        type: ApplicationCommandOptionType.Subcommand,
      },
      {
        name: "off",
        description: "turn temp voice off",
        type: ApplicationCommandOptionType.Subcommand,
      },
    ],
  },

  async messageRun(message, args, data) {
    const sub = args[0].toLowerCase();
    const settings = data.settings;

    if (sub === "setup") {
      const channel = message.guild.findMatchingChannels(args[1])[0];
      if (!channel) return message.safeReply("Provide a valid text channel");
      return message.safeReply(await setup(message.guild, settings, { panelChannel: channel }));
    }

    if (sub === "panel") {
      const channel = message.guild.findMatchingChannels(args[1])[0];
      if (!channel) return message.safeReply("Provide a valid text channel");
      return message.safeReply(await postPanel(message.guild, settings, channel));
    }

    if (sub === "status") return message.safeReply({ embeds: [await statusEmbed(message.guild, settings)] });

    if (sub === "off") return message.safeReply(await disable(message.guild, settings));

    return message.safeReply("Invalid subcommand");
  },

  async interactionRun(interaction, data) {
    const sub = interaction.options.getSubcommand();
    const settings = data.settings;

    if (sub === "setup") {
      return interaction.editReply(
        await setup(interaction.guild, settings, {
          panelChannel: interaction.options.getChannel("panel_channel"),
          hubChannel: interaction.options.getChannel("hub_channel"),
          category: interaction.options.getChannel("category"),
        })
      );
    }

    if (sub === "panel") {
      return interaction.editReply(
        await postPanel(interaction.guild, settings, interaction.options.getChannel("channel"))
      );
    }

    if (sub === "config") {
      return interaction.editReply(
        await configure(settings, {
          nameTemplate: interaction.options.getString("name_template"),
          limit: interaction.options.getInteger("limit"),
          locked: interaction.options.getBoolean("locked"),
          maxPerMember: interaction.options.getInteger("max_per_member"),
          claimable: interaction.options.getBoolean("claimable"),
          category: interaction.options.getChannel("category"),
        })
      );
    }

    if (sub === "status") return interaction.editReply({ embeds: [await statusEmbed(interaction.guild, settings)] });

    if (sub === "off") return interaction.editReply(await disable(interaction.guild, settings));

    return interaction.editReply("Invalid subcommand");
  },
};

/**
 * @param {import('discord.js').Guild} guild
 * @param {import('discord.js').TextChannel} channel
 */
function panelChannelProblem(guild, channel) {
  const permissions = channel.permissionsFor(guild.members.me);
  if (!permissions?.has(["ViewChannel", "SendMessages", "EmbedLinks"])) {
    return `I need to view, send messages and embed links in ${channel}.`;
  }
  return null;
}

async function setup(guild, settings, { panelChannel, hubChannel, category }) {
  const problem = panelChannelProblem(guild, panelChannel);
  if (problem) return problem;

  if (!guild.members.me.permissions.has(PermissionFlagsBits.ManageChannels)) {
    return "I need the **Manage Channels** permission to create personal voice channels.";
  }

  let hub = hubChannel;
  if (!hub) {
    hub = await guild.channels
      .create({
        name: DEFAULT_HUB_NAME,
        type: ChannelType.GuildVoice,
        parent: category?.id || panelChannel.parentId || null,
        reason: "TempVoice: join-to-create channel",
      })
      .catch(() => null);

    if (!hub) return "I could not create the join-to-create channel. Check my permissions and try again.";
  }

  settings.temp_voice.enabled = true;
  settings.temp_voice.hub_channel_id = hub.id;
  if (category) settings.temp_voice.category_id = category.id;

  await tempVoiceHandler.postPanel(panelChannel, settings);

  const t = guildTranslator(settings, guild);
  return t("tempvoice.setup.done", { hub: `${hub}`, panel: `${panelChannel}` });
}

async function postPanel(guild, settings, channel) {
  if (!settings.temp_voice?.hub_channel_id) {
    return guildTranslator(settings, guild)("tempvoice.setup.missingHub");
  }

  const problem = panelChannelProblem(guild, channel);
  if (problem) return problem;

  await tempVoiceHandler.postPanel(channel, settings);
  return guildTranslator(settings, guild)("tempvoice.setup.panelPosted", { channel: `${channel}` });
}

async function configure(settings, changes) {
  const config = settings.temp_voice;
  const applied = [];

  if (changes.nameTemplate) {
    config.name_template = changes.nameTemplate.slice(0, 100);
    applied.push(`name template \`${config.name_template}\``);
  }
  if (changes.limit !== null && changes.limit !== undefined) {
    config.default_limit = changes.limit;
    applied.push(`default limit ${changes.limit || "off"}`);
  }
  if (changes.locked !== null && changes.locked !== undefined) {
    config.default_locked = changes.locked;
    applied.push(`new channels start ${changes.locked ? "locked" : "open"}`);
  }
  if (changes.maxPerMember) {
    config.max_per_member = changes.maxPerMember;
    applied.push(`${changes.maxPerMember} channel(s) per member`);
  }
  if (changes.claimable !== null && changes.claimable !== undefined) {
    config.claimable = changes.claimable;
    applied.push(`claiming ${changes.claimable ? "allowed" : "blocked"}`);
  }
  if (changes.category) {
    config.category_id = changes.category.id;
    applied.push(`category ${changes.category.name}`);
  }

  if (!applied.length) return "Nothing to change. Provide at least one option.";

  await settings.save();
  return `TempVoice updated: ${applied.join(", ")}.`;
}

async function disable(guild, settings) {
  settings.temp_voice.enabled = false;
  await settings.save();
  return guildTranslator(settings, guild)("tempvoice.setup.disabled");
}

async function statusEmbed(guild, settings) {
  const config = settings.temp_voice || {};
  const t = guildTranslator(settings, guild);
  const active = await listGuildChannels(guild.id).catch(() => []);
  const notSet = t("common.notSet");

  return new EmbedBuilder()
    .setColor(EMBED_COLORS.BOT_EMBED)
    .setAuthor({ name: t("tempvoice.setup.statusTitle", { guild: guild.name }) })
    .setDescription(
      [
        t("tempvoice.setup.statusState", { value: config.enabled ? t("common.enabled") : t("common.disabled") }),
        t("tempvoice.setup.statusHub", { value: config.hub_channel_id ? `<#${config.hub_channel_id}>` : notSet }),
        t("tempvoice.setup.statusCategory", { value: config.category_id ? `<#${config.category_id}>` : notSet }),
        t("tempvoice.setup.statusPanel", { value: config.panel_channel_id ? `<#${config.panel_channel_id}>` : notSet }),
        t("tempvoice.setup.statusLimit", { value: config.default_limit || t("common.none") }),
        t("tempvoice.setup.statusTemplate", { value: `\`${config.name_template || "{user}"}\`` }),
        t("tempvoice.setup.statusActive", { value: active.length }),
      ].join("\n")
    );
}
