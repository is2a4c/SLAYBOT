const { ApplicationCommandOptionType, EmbedBuilder } = require("discord.js");
const { EMBED_COLORS } = require("@root/config");
const { getAiService } = require("@src/services/ai/AiService");

const STATUS_CHOICES = [
  { name: "ON", value: "ON" },
  { name: "OFF", value: "OFF" },
];

function ensureAiSettings(settings) {
  if (!settings.ai) settings.ai = {};
  const defaults = {
    enabled: false,
    automod_enabled: false,
    automod_mode: "SHADOW",
    automod_threshold: 85,
    ticket_summaries: false,
    knowledge_enabled: false,
    knowledge: "",
    suggestion_analysis: false,
    form_analysis: false,
  };
  for (const [key, value] of Object.entries(defaults)) {
    if (settings.ai[key] === undefined || settings.ai[key] === null) settings.ai[key] = value;
  }
  return settings.ai;
}

function parseStatus(value) {
  return String(value || "").toUpperCase() === "ON";
}

function statusEmbed(settings) {
  const ai = ensureAiSettings(settings);
  const configured = getAiService().isConfigured();
  return new EmbedBuilder()
    .setColor(EMBED_COLORS.BOT_EMBED)
    .setAuthor({ name: "SLAYBOT AI" })
    .setDescription(
      [
        `**Provider:** ${configured ? "io.net configured" : "io.net key missing"}`,
        `**Master switch:** ${ai.enabled ? "ON" : "OFF"}`,
        `**Text AutoMod:** ${ai.automod_enabled ? `${ai.automod_mode} ≥ ${ai.automod_threshold}` : "OFF"}`,
        `**Ticket summaries:** ${ai.ticket_summaries ? "ON" : "OFF"}`,
        `**Knowledge Q&A:** ${ai.knowledge_enabled && ai.knowledge ? "ON" : "OFF"}`,
        `**Suggestion analysis:** ${ai.suggestion_analysis ? "ON" : "OFF"}`,
        `**Form assistance:** ${ai.form_analysis ? "ON" : "OFF"}`,
      ].join("\n")
    );
}

async function saveFeature(settings, key, status) {
  const ai = ensureAiSettings(settings);
  ai[key] = parseStatus(status);
  await settings.save();
  return `AI setting saved: \`${key}\` is now **${ai[key] ? "ON" : "OFF"}**.`;
}

/**
 * @type {import("@structures/Command")}
 */
module.exports = {
  name: "ai",
  description: "configure SLAYBOT AI features",
  category: "ADMIN",
  cooldown: 2,
  userPermissions: ["ManageGuild"],
  command: {
    enabled: true,
    minArgsCount: 1,
    subcommands: [
      { trigger: "status", description: "show AI configuration" },
      { trigger: "enable <on|off>", description: "enable or disable AI features globally" },
      { trigger: "automod <on|off> [shadow|enforce] [50-100]", description: "configure semantic text moderation" },
      { trigger: "tickets <on|off>", description: "configure ticket summaries" },
      { trigger: "suggestions <on|off>", description: "configure suggestion analysis" },
      { trigger: "forms <on|off>", description: "configure neutral form response assistance" },
      { trigger: "knowledge-set <text>", description: "replace server knowledge used by !ask" },
      { trigger: "knowledge-clear", description: "clear server knowledge" },
    ],
  },
  slashCommand: {
    enabled: true,
    ephemeral: true,
    options: [
      {
        name: "status",
        description: "show AI configuration",
        type: ApplicationCommandOptionType.Subcommand,
      },
      {
        name: "enable",
        description: "enable or disable AI features globally",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "status",
            description: "master AI status",
            type: ApplicationCommandOptionType.String,
            required: true,
            choices: STATUS_CHOICES,
          },
        ],
      },
      {
        name: "automod",
        description: "configure semantic text moderation",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "status",
            description: "text moderation status",
            type: ApplicationCommandOptionType.String,
            required: true,
            choices: STATUS_CHOICES,
          },
          {
            name: "mode",
            description: "shadow only logs; enforce deletes and adds one strike",
            type: ApplicationCommandOptionType.String,
            required: false,
            choices: [
              { name: "SHADOW", value: "SHADOW" },
              { name: "ENFORCE", value: "ENFORCE" },
            ],
          },
          {
            name: "threshold",
            description: "minimum risk score",
            type: ApplicationCommandOptionType.Integer,
            required: false,
            minValue: 50,
            maxValue: 100,
          },
        ],
      },
      {
        name: "tickets",
        description: "configure on-demand ticket summaries",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "status",
            description: "ticket summary status",
            type: ApplicationCommandOptionType.String,
            required: true,
            choices: STATUS_CHOICES,
          },
        ],
      },
      {
        name: "suggestions",
        description: "configure suggestion analysis",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "status",
            description: "suggestion analysis status",
            type: ApplicationCommandOptionType.String,
            required: true,
            choices: STATUS_CHOICES,
          },
        ],
      },
      {
        name: "forms",
        description: "configure neutral form response assistance",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "status",
            description: "form assistance status",
            type: ApplicationCommandOptionType.String,
            required: true,
            choices: STATUS_CHOICES,
          },
        ],
      },
      {
        name: "knowledge-set",
        description: "replace knowledge used by the ask command",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "content",
            description: "server rules, FAQ, and instructions",
            type: ApplicationCommandOptionType.String,
            required: true,
            maxLength: 4000,
          },
        ],
      },
      {
        name: "knowledge-clear",
        description: "clear server knowledge",
        type: ApplicationCommandOptionType.Subcommand,
      },
    ],
  },

  async messageRun(message, args, data) {
    const sub = String(args.shift() || "").toLowerCase();
    const ai = ensureAiSettings(data.settings);
    let response;

    if (sub === "status") response = { embeds: [statusEmbed(data.settings)] };
    else if (sub === "enable") response = await saveFeature(data.settings, "enabled", args[0]);
    else if (sub === "tickets") response = await saveFeature(data.settings, "ticket_summaries", args[0]);
    else if (sub === "suggestions") response = await saveFeature(data.settings, "suggestion_analysis", args[0]);
    else if (sub === "forms") response = await saveFeature(data.settings, "form_analysis", args[0]);
    else if (sub === "automod") {
      ai.automod_enabled = parseStatus(args[0]);
      if (args[1]) ai.automod_mode = String(args[1]).toUpperCase() === "ENFORCE" ? "ENFORCE" : "SHADOW";
      if (args[2]) ai.automod_threshold = Math.min(100, Math.max(50, Number.parseInt(args[2], 10) || 85));
      await data.settings.save();
      response = `AI text moderation is **${ai.automod_enabled ? "ON" : "OFF"}** in \`${ai.automod_mode}\` mode at \`${ai.automod_threshold}\`.`;
    } else if (sub === "knowledge-set") {
      const content = args.join(" ").trim().slice(0, 12_000);
      if (!content) return message.safeReply("Provide server knowledge text.");
      ai.knowledge = content;
      ai.knowledge_enabled = true;
      await data.settings.save();
      response = `Server knowledge replaced (${content.length} characters).`;
    } else if (sub === "knowledge-clear") {
      ai.knowledge = "";
      ai.knowledge_enabled = false;
      await data.settings.save();
      response = "Server knowledge cleared.";
    } else response = "Incorrect command usage.";

    return message.safeReply(response);
  },

  async interactionRun(interaction, data) {
    const sub = interaction.options.getSubcommand();
    const ai = ensureAiSettings(data.settings);
    let response;

    if (sub === "status") response = { embeds: [statusEmbed(data.settings)] };
    else if (sub === "enable")
      response = await saveFeature(data.settings, "enabled", interaction.options.getString("status"));
    else if (sub === "tickets")
      response = await saveFeature(data.settings, "ticket_summaries", interaction.options.getString("status"));
    else if (sub === "suggestions")
      response = await saveFeature(data.settings, "suggestion_analysis", interaction.options.getString("status"));
    else if (sub === "forms")
      response = await saveFeature(data.settings, "form_analysis", interaction.options.getString("status"));
    else if (sub === "automod") {
      ai.automod_enabled = parseStatus(interaction.options.getString("status"));
      ai.automod_mode = interaction.options.getString("mode") || ai.automod_mode || "SHADOW";
      ai.automod_threshold = interaction.options.getInteger("threshold") || ai.automod_threshold || 85;
      await data.settings.save();
      response = `AI text moderation is **${ai.automod_enabled ? "ON" : "OFF"}** in \`${ai.automod_mode}\` mode at \`${ai.automod_threshold}\`.`;
    } else if (sub === "knowledge-set") {
      const content = interaction.options.getString("content").trim().slice(0, 12_000);
      ai.knowledge = content;
      ai.knowledge_enabled = true;
      await data.settings.save();
      response = `Server knowledge replaced (${content.length} characters).`;
    } else if (sub === "knowledge-clear") {
      ai.knowledge = "";
      ai.knowledge_enabled = false;
      await data.settings.save();
      response = "Server knowledge cleared.";
    }

    return interaction.followUp(response);
  },

  ensureAiSettings,
  parseStatus,
  saveFeature,
  statusEmbed,
};
