const { ApplicationCommandOptionType } = require("discord.js");
const { classifyImage, isImageAttachment } = require("@src/services/imageSpamClassifier");

/**
 * @type {import("@structures/Command")}
 */
module.exports = {
  name: "anti",
  description: "manage various automod settings for the server",
  category: "AUTOMOD",
  userPermissions: ["ManageGuild"],
  command: {
    enabled: true,
    minArgsCount: 2,
    subcommands: [
      {
        trigger: "ghostping <on|off>",
        description: "detect and logs ghost mentions in your server",
      },
      {
        trigger: "spam <on|off>",
        description: "enable or disable antispam detection",
      },
      {
        trigger: "imagespam <on|off> [threshold]",
        description: "detect image spam with local OCR (safe threshold: 70)",
      },
      {
        trigger: "imagespam test [caption]",
        description: "owner-only image analysis without deleting the message",
      },
      {
        trigger: "massmention <on|off> [threshold]",
        description: "enable or disable massmention detection [default threshold is 3 mentions]",
      },
    ],
  },
  slashCommand: {
    enabled: true,
    ephemeral: true,
    options: [
      {
        name: "ghostping",
        description: "detects and logs ghost mentions in your server",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "status",
            description: "configuration status",
            required: true,
            type: ApplicationCommandOptionType.String,
            choices: [
              {
                name: "ON",
                value: "ON",
              },
              {
                name: "OFF",
                value: "OFF",
              },
            ],
          },
        ],
      },
      {
        name: "spam",
        description: "enable or disable antispam detection",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "status",
            description: "configuration status",
            required: true,
            type: ApplicationCommandOptionType.String,
            choices: [
              {
                name: "ON",
                value: "ON",
              },
              {
                name: "OFF",
                value: "OFF",
              },
            ],
          },
        ],
      },
      {
        name: "imagespam",
        description: "detect image spam with local OCR",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "status",
            description: "configuration status",
            required: true,
            type: ApplicationCommandOptionType.String,
            choices: [
              { name: "ON", value: "ON" },
              { name: "OFF", value: "OFF" },
            ],
          },
          {
            name: "threshold",
            description: "risk score required to delete (50-100, recommended 70)",
            required: false,
            type: ApplicationCommandOptionType.Integer,
            minValue: 50,
            maxValue: 100,
          },
        ],
      },
      {
        name: "massmention",
        description: "enable or disable massmention detection",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "status",
            description: "configuration status",
            required: true,
            type: ApplicationCommandOptionType.String,
            choices: [
              {
                name: "ON",
                value: "ON",
              },
              {
                name: "OFF",
                value: "OFF",
              },
            ],
          },
          {
            name: "threshold",
            description: "configuration threshold (default is 3 mentions)",
            required: true,
            type: ApplicationCommandOptionType.Integer,
          },
        ],
      },
    ],
  },

  async messageRun(message, args, data) {
    const settings = data.settings;
    const sub = args[0].toLowerCase();

    let response;
    if (sub == "ghostping") {
      const status = args[1].toLowerCase();
      if (!["on", "off"].includes(status)) return message.safeReply("Invalid status. Value must be `on/off`");
      response = await antiGhostPing(settings, status);
    }

    //
    else if (sub == "spam") {
      const status = args[1].toLowerCase();
      if (!["on", "off"].includes(status)) return message.safeReply("Invalid status. Value must be `on/off`");
      response = await antiSpam(settings, status);
    }

    //
    else if (sub == "imagespam") {
      const status = args[1]?.toLowerCase();
      if (status === "test") return testImageSpam(message, settings, args.slice(2).join(" "));
      if (!["on", "off"].includes(status)) return message.safeReply("Invalid status. Value must be `on/off`");
      response = await antiImageSpam(settings, status, args[2]);
    }

    //
    else if (sub === "massmention") {
      const status = args[1].toLowerCase();
      const threshold = args[2] || 3;
      if (!["on", "off"].includes(status)) return message.safeReply("Invalid status. Value must be `on/off`");
      response = await antiMassMention(settings, status, threshold);
    }

    //
    else response = "Invalid command usage!";
    await message.safeReply(response);
  },

  async interactionRun(interaction, data) {
    const sub = interaction.options.getSubcommand();
    const settings = data.settings;

    let response;
    if (sub == "ghostping") response = await antiGhostPing(settings, interaction.options.getString("status"));
    else if (sub == "spam") response = await antiSpam(settings, interaction.options.getString("status"));
    else if (sub == "imagespam") {
      response = await antiImageSpam(
        settings,
        interaction.options.getString("status"),
        interaction.options.getInteger("threshold")
      );
    } else if (sub === "massmention") {
      response = await antiMassMention(
        settings,
        interaction.options.getString("status"),
        interaction.options.getInteger("threshold")
      );
    } else response = "Invalid command usage!";

    await interaction.safeFollowUp(response);
  },
};

async function antiGhostPing(settings, input) {
  const status = input.toUpperCase() === "ON" ? true : false;
  settings.automod.anti_ghostping = status;
  await settings.save();
  return `Configuration saved! Anti-Ghostping is now ${status ? "enabled" : "disabled"}`;
}

async function antiSpam(settings, input) {
  const status = input.toUpperCase() === "ON" ? true : false;
  settings.automod.anti_spam = status;
  await settings.save();
  return `Antispam detection is now ${status ? "enabled" : "disabled"}`;
}

async function antiImageSpam(settings, input, requestedThreshold) {
  const status = input.toUpperCase() === "ON";
  const threshold =
    requestedThreshold == null ? settings.automod.image_spam_threshold || 70 : Number(requestedThreshold);
  if (!Number.isInteger(threshold) || threshold < 50 || threshold > 100) {
    return "Threshold must be a whole number from 50 to 100";
  }

  settings.automod.anti_image_spam = status;
  settings.automod.image_spam_threshold = threshold;
  await settings.save();
  return `Image-spam detection is now ${status ? `enabled at ${threshold}/100` : "disabled"}`;
}

async function testImageSpam(message, settings, suppliedCaption) {
  if (message.guild.ownerId !== message.author.id) {
    return message.safeReply("Only the server owner can run the image-spam test");
  }

  let source = message;
  let attachment = source.attachments.find(isImageAttachment);
  if (!attachment && message.reference?.messageId) {
    source = await message.fetchReference();
    attachment = source.attachments.find(isImageAttachment);
  }
  if (!attachment) {
    return message.safeReply("Attach an image to this command or reply with the command to a message containing one");
  }

  await message.channel.sendTyping().catch(() => {});
  const threshold = settings.automod.image_spam_threshold || 70;
  const caption = suppliedCaption || (source.id === message.id ? "" : source.content);
  const result = await classifyImage({ url: attachment.url, caption, threshold });
  const reasons = result.reasons.length ? result.reasons.map((reason) => `- ${reason}`).join("\n") : "- none";
  const ocr = (result.ocrText || "none").replace(/```/g, "''' ").slice(0, 700);
  const output = [
    `**Image-spam test: ${result.risky ? "SPAM" : "SAFE"}**`,
    `Score: **${result.score}/100** (threshold: ${result.threshold})`,
    `Model: ${result.model}`,
    `OCR confidence: ${result.confidence}%`,
    "**Reasons**",
    reasons,
    `**OCR**\n\`\`\`\n${ocr}\n\`\`\``,
    "Test mode: no message was deleted and no strike was added.",
  ].join("\n");

  return message.safeReply(output.slice(0, 1950));
}

async function antiMassMention(settings, input, threshold) {
  const status = input.toUpperCase() === "ON" ? true : false;
  if (!status) {
    settings.automod.anti_massmention = 0;
  } else {
    threshold = Number.parseInt(threshold, 10);
    if (!Number.isInteger(threshold) || threshold < 1) return "Threshold must be a valid number greater than 0";
    settings.automod.anti_massmention = threshold;
  }
  await settings.save();
  return `Mass mention detection is now ${status ? "enabled" : "disabled"}`;
}
