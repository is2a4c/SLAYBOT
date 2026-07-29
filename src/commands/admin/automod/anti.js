const { ApplicationCommandOptionType } = require("discord.js");
const { classifyImage, isImageAttachment } = require("@src/services/imageSpamClassifier");
const { getMember } = require("@schemas/Member");

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
        trigger: "spam-whitelist <user|role> <add|remove|list|clear> [user|role ID]",
        description: "manage antispam-only user and role exemptions",
      },
      {
        trigger: "strikes-reset <user>",
        description: "reset all automod strikes for a user",
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
        name: "spam-whitelist-user",
        description: "add or remove a user from the antispam whitelist",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "action",
            description: "whitelist action",
            required: true,
            type: ApplicationCommandOptionType.String,
            choices: [
              { name: "ADD", value: "ADD" },
              { name: "REMOVE", value: "REMOVE" },
            ],
          },
          {
            name: "user",
            description: "user to add or remove",
            required: true,
            type: ApplicationCommandOptionType.User,
          },
        ],
      },
      {
        name: "spam-whitelist-role",
        description: "add or remove a role from the antispam whitelist",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "action",
            description: "whitelist action",
            required: true,
            type: ApplicationCommandOptionType.String,
            choices: [
              { name: "ADD", value: "ADD" },
              { name: "REMOVE", value: "REMOVE" },
            ],
          },
          {
            name: "role",
            description: "role to add or remove",
            required: true,
            type: ApplicationCommandOptionType.Role,
          },
        ],
      },
      {
        name: "spam-whitelist-list",
        description: "show the antispam user and role whitelist",
        type: ApplicationCommandOptionType.Subcommand,
      },
      {
        name: "spam-whitelist-clear",
        description: "clear antispam whitelist entries",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "target",
            description: "entries to clear",
            required: true,
            type: ApplicationCommandOptionType.String,
            choices: [
              { name: "USERS", value: "USERS" },
              { name: "ROLES", value: "ROLES" },
              { name: "ALL", value: "ALL" },
            ],
          },
        ],
      },
      {
        name: "strikes-reset",
        description: "reset all automod strikes for a user",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "user",
            description: "user whose automod strikes should be reset",
            required: true,
            type: ApplicationCommandOptionType.User,
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
    else if (sub === "spam-whitelist") {
      response = await runPrefixWhitelist(message, settings, args.slice(1));
    }

    //
    else if (sub === "strikes-reset") {
      response = await resetMemberStrikes(message.guildId, args[1]);
    }

    //
    else if (sub == "imagespam") {
      if (args[1]?.toLowerCase() !== "test") return message.safeReply("Use `/anti imagespam` to change settings");
      return testImageSpam(message, settings, args.slice(2).join(" "));
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
    else if (sub === "spam-whitelist-user") {
      response = await updateWhitelist(
        settings,
        "users",
        interaction.options.getString("action"),
        interaction.options.getUser("user")?.id
      );
    } else if (sub === "spam-whitelist-role") {
      const role = interaction.options.getRole("role");
      response = await updateWhitelist(settings, "roles", interaction.options.getString("action"), role?.id, {
        guild: interaction.guild,
        role,
      });
    } else if (sub === "spam-whitelist-list") {
      response = formatWhitelist(settings.automod, interaction.guild);
    } else if (sub === "spam-whitelist-clear") {
      response = await clearWhitelist(settings, interaction.options.getString("target"));
    } else if (sub === "strikes-reset") {
      response = await resetMemberStrikes(interaction.guildId, interaction.options.getUser("user")?.id);
    } else if (sub == "imagespam") {
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

async function resetMemberStrikes(guildId, input, memberLoader = getMember) {
  const userId = normalizeSnowflake(input);
  if (!userId) return "Invalid user. Mention a server member or provide a valid user ID.";

  const memberDb = await memberLoader(guildId, userId);
  const previousStrikes = Math.max(0, Number(memberDb.strikes) || 0);
  if (previousStrikes === 0) {
    return `User \`${userId}\` has no AutoMod strikes to reset.`;
  }

  memberDb.strikes = 0;
  await memberDb.save();
  return `Reset AutoMod strikes for user \`${userId}\`: ${previousStrikes} → 0.`;
}

function normalizeSnowflake(input) {
  const value = String(input || "").trim();
  if (/^\d{17,20}$/.test(value)) return value;
  return value.match(/^<@(?:!?|&)(\d{17,20})>$/)?.[1] || null;
}

function getWhitelist(settings, target) {
  const key = target === "users" ? "spam_whitelist_users" : "spam_whitelist_roles";
  const values = settings.automod[key] || [];
  settings.automod[key] = [...new Set(values.filter((id) => normalizeSnowflake(id)))];
  return { key, values: settings.automod[key] };
}

async function addWhitelistEntry(settings, target, input, context = {}) {
  const id = normalizeSnowflake(input);
  if (!id) return `Invalid ${target === "users" ? "user" : "role"} ID.`;

  const { key, values } = getWhitelist(settings, target);
  if (values.includes(id)) {
    return `${target === "users" ? "User" : "Role"} \`${id}\` is already in the antispam whitelist.`;
  }

  if (target === "roles") {
    const role = context.role || context.guild?.roles?.cache?.get(id);
    if (id === context.guild?.id) return "The @everyone role cannot be added to the antispam whitelist.";
    if (role?.managed) return "Managed integration roles cannot be added to the antispam whitelist.";
  }

  settings.automod[key] = [...values, id];
  await settings.save();
  return `${target === "users" ? "User" : "Role"} \`${id}\` was added to the antispam whitelist.`;
}

async function removeWhitelistEntry(settings, target, input) {
  const id = normalizeSnowflake(input);
  if (!id) return `Invalid ${target === "users" ? "user" : "role"} ID.`;

  const { key, values } = getWhitelist(settings, target);
  if (!values.includes(id)) {
    return `${target === "users" ? "User" : "Role"} \`${id}\` is not in the antispam whitelist.`;
  }

  settings.automod[key] = values.filter((entry) => entry !== id);
  await settings.save();
  return `${target === "users" ? "User" : "Role"} \`${id}\` was removed from the antispam whitelist.`;
}

async function clearWhitelist(settings, input) {
  const target = String(input || "").toLowerCase();
  if (!["users", "roles", "all"].includes(target)) return "Invalid target. Use `users`, `roles`, or `all`.";

  if (target === "users" || target === "all") settings.automod.spam_whitelist_users = [];
  if (target === "roles" || target === "all") settings.automod.spam_whitelist_roles = [];
  await settings.save();
  return `Cleared antispam whitelist ${target === "all" ? "users and roles" : target}.`;
}

async function updateWhitelist(settings, target, action, input, context) {
  if (String(action).toUpperCase() === "ADD") {
    return addWhitelistEntry(settings, target, input, context);
  }
  if (String(action).toUpperCase() === "REMOVE") {
    return removeWhitelistEntry(settings, target, input);
  }
  return "Invalid action. Use `add` or `remove`.";
}

function formatWhitelist(automod, guild, limit = 1950) {
  const userIds = [...new Set((automod.spam_whitelist_users || []).filter((id) => normalizeSnowflake(id)))];
  const roleIds = [...new Set((automod.spam_whitelist_roles || []).filter((id) => normalizeSnowflake(id)))];
  const userEntries = userIds.map((id) => {
    const known = guild?.members?.cache?.has(id);
    return known ? `• <@${id}> (\`${id}\`)` : `• Unknown User (\`${id}\`)`;
  });
  const roleEntries = roleIds.map((id) => {
    const known = guild?.roles?.cache?.has(id);
    return known ? `• <@&${id}> (\`${id}\`)` : `• Unknown Role (\`${id}\`)`;
  });
  const visibleUsers = [...userEntries];
  const visibleRoles = [...roleEntries];

  const render = () => {
    const hidden = userEntries.length + roleEntries.length - visibleUsers.length - visibleRoles.length;
    return [
      "**Antispam Whitelist**",
      "",
      `**Users — ${userIds.length}**`,
      ...(visibleUsers.length ? visibleUsers : ["• None"]),
      "",
      `**Roles — ${roleIds.length}**`,
      ...(visibleRoles.length ? visibleRoles : ["• None"]),
      ...(hidden ? [`… and ${hidden} more ${hidden === 1 ? "entry" : "entries"}.`] : []),
    ].join("\n");
  };

  while (render().length > limit && (visibleUsers.length || visibleRoles.length)) {
    if (visibleUsers.length >= visibleRoles.length && visibleUsers.length) visibleUsers.pop();
    else visibleRoles.pop();
  }
  return render().slice(0, limit);
}

async function runPrefixWhitelist(message, settings, args) {
  const target = args[0]?.toLowerCase();
  const action = args[1]?.toLowerCase();
  if (!["user", "role"].includes(target)) {
    return "Invalid target. Use `user` or `role`.";
  }
  const pluralTarget = `${target}s`;
  if (action === "list") return formatWhitelist(settings.automod, message.guild);
  if (action === "clear") return clearWhitelist(settings, pluralTarget);
  if (!["add", "remove"].includes(action)) {
    return "Invalid action. Use `add`, `remove`, `list`, or `clear`.";
  }
  return updateWhitelist(settings, pluralTarget, action, args[2], { guild: message.guild });
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
  let result;
  try {
    result = await classifyImage({ url: attachment.url, caption, threshold, guildId: message.guildId });
  } catch (error) {
    return message.safeReply(`Image-spam test could not finish: ${error.message}`);
  }
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

Object.assign(module.exports, {
  normalizeSnowflake,
  addWhitelistEntry,
  removeWhitelistEntry,
  clearWhitelist,
  updateWhitelist,
  formatWhitelist,
  runPrefixWhitelist,
  resetMemberStrikes,
});
