const { ApplicationCommandOptionType, ChannelType, EmbedBuilder, WebhookClient } = require("discord.js");
const { EMBED_COLORS } = require("@root/config");

const MAX_WEBHOOKS_PER_CHANNEL = 15;
const BOT_WEBHOOK_REASON = "Created by /webhook";

/**
 * @type {import("@structures/Command")}
 */
module.exports = {
  name: "webhook",
  description: "create, list, delete and post through channel webhooks",
  category: "ADMIN",
  userPermissions: ["ManageWebhooks"],
  botPermissions: ["ManageWebhooks", "EmbedLinks"],
  command: {
    enabled: true,
    usage: "<create|list|delete|send> ...",
    minArgsCount: 1,
    subcommands: [
      { trigger: "create <#channel> <name>", description: "create a webhook in a channel" },
      { trigger: "list [#channel]", description: "list the webhooks of a channel or the server" },
      { trigger: "delete <#channel> <name>", description: "delete a webhook by name" },
      { trigger: "send <#channel> <name> <message>", description: "post a message through a webhook" },
    ],
  },
  slashCommand: {
    enabled: true,
    ephemeral: true,
    options: [
      {
        name: "create",
        description: "create a webhook in a channel",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "channel",
            description: "channel the webhook posts to",
            type: ApplicationCommandOptionType.Channel,
            channelTypes: [ChannelType.GuildText, ChannelType.GuildAnnouncement],
            required: true,
          },
          {
            name: "name",
            description: "webhook name, also the display name of its messages",
            type: ApplicationCommandOptionType.String,
            required: true,
          },
          {
            name: "avatar",
            description: "image url used as the webhook avatar",
            type: ApplicationCommandOptionType.String,
            required: false,
          },
          {
            name: "show_url",
            description: "reveal the webhook url (treat it like a password)",
            type: ApplicationCommandOptionType.Boolean,
            required: false,
          },
        ],
      },
      {
        name: "list",
        description: "list the webhooks of a channel or the whole server",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "channel",
            description: "only list this channel",
            type: ApplicationCommandOptionType.Channel,
            required: false,
          },
        ],
      },
      {
        name: "delete",
        description: "delete a webhook",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "channel",
            description: "channel the webhook belongs to",
            type: ApplicationCommandOptionType.Channel,
            required: true,
          },
          {
            name: "name",
            description: "webhook name",
            type: ApplicationCommandOptionType.String,
            required: true,
          },
        ],
      },
      {
        name: "send",
        description: "post a message through one of the server's webhooks",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "channel",
            description: "channel the webhook belongs to",
            type: ApplicationCommandOptionType.Channel,
            channelTypes: [ChannelType.GuildText, ChannelType.GuildAnnouncement],
            required: true,
          },
          {
            name: "name",
            description: "webhook name",
            type: ApplicationCommandOptionType.String,
            required: true,
          },
          {
            name: "message",
            description: "text to post (use \\n for a line break)",
            type: ApplicationCommandOptionType.String,
            required: true,
          },
          {
            name: "embed",
            description: "post as an embed instead of plain text",
            type: ApplicationCommandOptionType.Boolean,
            required: false,
          },
          {
            name: "username",
            description: "override the display name for this message",
            type: ApplicationCommandOptionType.String,
            required: false,
          },
        ],
      },
    ],
  },

  async messageRun(message, args) {
    const sub = args[0].toLowerCase();
    const channel = args[1] ? message.guild.findMatchingChannels(args[1])[0] : null;

    if (sub === "create") {
      if (!channel) return message.safeReply("Provide a valid text channel");
      return message.safeReply(await create(message.guild, channel, args.slice(2).join(" "), null, false));
    }

    if (sub === "list") return message.safeReply(await list(message.guild, channel));

    if (sub === "delete") {
      if (!channel) return message.safeReply("Provide a valid text channel");
      return message.safeReply(await remove(channel, args.slice(2).join(" ")));
    }

    if (sub === "send") {
      if (!channel) return message.safeReply("Provide a valid text channel");
      return message.safeReply(await send(channel, args[2], args.slice(3).join(" "), {}));
    }

    return message.safeReply("Invalid subcommand");
  },

  async interactionRun(interaction) {
    const sub = interaction.options.getSubcommand();
    const channel = interaction.options.getChannel("channel");

    if (sub === "create") {
      return interaction.safeFollowUp(
        await create(
          interaction.guild,
          channel,
          interaction.options.getString("name"),
          interaction.options.getString("avatar"),
          interaction.options.getBoolean("show_url")
        )
      );
    }

    if (sub === "list") return interaction.safeFollowUp(await list(interaction.guild, channel));

    if (sub === "delete") return interaction.safeFollowUp(await remove(channel, interaction.options.getString("name")));

    if (sub === "send") {
      return interaction.safeFollowUp(
        await send(channel, interaction.options.getString("name"), interaction.options.getString("message"), {
          embed: interaction.options.getBoolean("embed"),
          username: interaction.options.getString("username"),
        })
      );
    }

    return interaction.safeFollowUp("Invalid subcommand");
  },
};

/**
 * @param {import('discord.js').GuildTextBasedChannel} channel
 * @param {string} name
 */
async function findWebhook(channel, name) {
  if (!name) return null;
  const hooks = await channel.fetchWebhooks().catch(() => null);
  if (!hooks) return null;
  return hooks.find((hook) => hook.name.toLowerCase() === name.trim().toLowerCase()) || null;
}

async function create(guild, channel, name, avatar, showUrl) {
  const trimmed = String(name || "").trim();
  if (trimmed.length < 1 || trimmed.length > 80) return "The webhook name must be 1-80 characters.";
  if (/clyde|discord/i.test(trimmed)) return "Discord does not allow `clyde` or `discord` in a webhook name.";

  if (!channel.isTextBased() || channel.isThread()) return "Webhooks live on text channels, not threads.";
  if (!channel.permissionsFor(guild.members.me)?.has("ManageWebhooks")) {
    return `I need the \`Manage Webhooks\` permission in ${channel}.`;
  }

  const existing = await channel.fetchWebhooks().catch(() => null);
  if (existing && existing.size >= MAX_WEBHOOKS_PER_CHANNEL) {
    return `${channel} already has ${MAX_WEBHOOKS_PER_CHANNEL} webhooks, which is Discord's limit.`;
  }
  if (await findWebhook(channel, trimmed)) return `${channel} already has a webhook named \`${trimmed}\`.`;

  let webhook;
  try {
    webhook = await channel.createWebhook({
      name: trimmed,
      avatar: avatar || undefined,
      reason: BOT_WEBHOOK_REASON,
    });
  } catch (ex) {
    return `I could not create that webhook: ${ex.message}`;
  }

  // The url is a credential: it is only revealed when explicitly asked for, and
  // the reply is ephemeral.
  return showUrl
    ? `Created \`${webhook.name}\` in ${channel}.\nURL (keep it secret): ${webhook.url}`
    : `Created \`${webhook.name}\` in ${channel}. Post through it with \`/webhook send\`, or re-run with \`show_url:true\` to get its URL.`;
}

async function list(guild, channel) {
  const hooks = channel
    ? await channel.fetchWebhooks().catch(() => null)
    : await guild.fetchWebhooks().catch(() => null);
  if (!hooks) return "I could not read the webhooks. Do I have `Manage Webhooks`?";
  if (hooks.size === 0) return channel ? `${channel} has no webhooks.` : "This server has no webhooks.";

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLORS.BOT_EMBED)
    .setAuthor({ name: channel ? `Webhooks · #${channel.name}` : `Webhooks · ${guild.name}` })
    .setDescription(
      [...hooks.values()]
        .map(
          (hook) =>
            `**${hook.name}** · <#${hook.channelId}>` +
            `${hook.owner ? ` · by ${hook.owner.username}` : ""}${hook.applicationId ? " · app-owned" : ""}`
        )
        .join("\n")
        .slice(0, 4000)
    )
    .setFooter({ text: "URLs are never listed. Use /webhook create show_url:true for a new one." });

  return { embeds: [embed] };
}

async function remove(channel, name) {
  if (!channel?.isTextBased()) return "Provide a valid text channel.";

  const webhook = await findWebhook(channel, name);
  if (!webhook) return `${channel} has no webhook named \`${name}\`.`;

  try {
    await webhook.delete("Deleted by /webhook delete");
  } catch (ex) {
    return `I could not delete that webhook: ${ex.message}`;
  }

  return `Deleted \`${webhook.name}\` from ${channel}.`;
}

async function send(channel, name, content, { embed = false, username = null } = {}) {
  if (!channel?.isTextBased()) return "Provide a valid text channel.";

  const webhook = await findWebhook(channel, name);
  if (!webhook) return `${channel} has no webhook named \`${name}\`.`;
  if (!webhook.token) return "That webhook was created by another application, so I cannot post through it.";

  const text = String(content || "")
    .replace(/\\n/g, "\n")
    .slice(0, 2000);
  if (!text) return "Provide the message to post.";

  const client = new WebhookClient({ url: webhook.url });
  try {
    await client.send({
      username: username ? username.slice(0, 80) : undefined,
      content: embed ? undefined : text,
      embeds: embed ? [new EmbedBuilder().setColor(EMBED_COLORS.BOT_EMBED).setDescription(text)] : undefined,
      // Webhook messages must never be able to ping everyone.
      allowedMentions: { parse: ["users", "roles"] },
    });
  } catch (ex) {
    return `I could not post that: ${ex.message}`;
  } finally {
    client.destroy();
  }

  return `Posted through \`${webhook.name}\` in ${channel}.`;
}
