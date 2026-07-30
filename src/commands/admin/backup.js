const { ApplicationCommandOptionType, ChannelType, EmbedBuilder, time } = require("discord.js");
const { EMBED_COLORS } = require("@root/config");
const {
  MAX_BACKUPS_PER_GUILD,
  createBackup,
  deleteBackup,
  getBackup,
  listBackups,
  pruneBackups,
} = require("@schemas/GuildBackup");
const { applyRestore, newBackupId, planRestore, snapshotGuild } = require("@src/services/backups/GuildBackups");

/**
 * @type {import("@structures/Command")}
 */
module.exports = {
  name: "backup",
  description: "snapshot the roles, channels and settings of this server",
  category: "ADMIN",
  userPermissions: ["Administrator"],
  botPermissions: ["ManageChannels", "ManageRoles", "EmbedLinks"],
  command: {
    enabled: true,
    usage: "<create|list|info|load|delete> ...",
    minArgsCount: 1,
    subcommands: [
      { trigger: "create [name]", description: "take a snapshot of the server structure" },
      { trigger: "list", description: "list the stored snapshots" },
      { trigger: "info <id>", description: "show what a snapshot contains" },
      { trigger: "load <id>", description: "re-create everything the server is missing" },
      { trigger: "delete <id>", description: "delete a snapshot" },
    ],
  },
  slashCommand: {
    enabled: true,
    ephemeral: true,
    options: [
      {
        name: "create",
        description: "take a snapshot of the server structure",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "name",
            description: "label for this snapshot",
            type: ApplicationCommandOptionType.String,
            required: false,
          },
        ],
      },
      {
        name: "list",
        description: "list the stored snapshots",
        type: ApplicationCommandOptionType.Subcommand,
      },
      {
        name: "info",
        description: "show what a snapshot contains",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "id",
            description: "snapshot id from /backup list",
            type: ApplicationCommandOptionType.String,
            required: true,
          },
        ],
      },
      {
        name: "load",
        description: "re-create the roles and channels the server is missing",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "id",
            description: "snapshot id from /backup list",
            type: ApplicationCommandOptionType.String,
            required: true,
          },
          {
            name: "confirm",
            description: "set to true to actually create them",
            type: ApplicationCommandOptionType.Boolean,
            required: false,
          },
        ],
      },
      {
        name: "delete",
        description: "delete a snapshot",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "id",
            description: "snapshot id from /backup list",
            type: ApplicationCommandOptionType.String,
            required: true,
          },
        ],
      },
    ],
  },

  async messageRun(message, args) {
    const sub = args[0].toLowerCase();

    if (sub === "create")
      return message.safeReply(await create(message.guild, message.author.id, args.slice(1).join(" ")));
    if (sub === "list") return message.safeReply(await list(message.guild));
    if (sub === "info") return message.safeReply(await info(message.guild, args[1]));
    if (sub === "load") return message.safeReply(await load(message.guild, args[1], false));
    if (sub === "delete") return message.safeReply(await remove(message.guild, args[1]));

    return message.safeReply("Invalid subcommand");
  },

  async interactionRun(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === "create") {
      return interaction.followUp(
        await create(interaction.guild, interaction.user.id, interaction.options.getString("name"))
      );
    }
    if (sub === "list") return interaction.followUp(await list(interaction.guild));
    if (sub === "info") return interaction.followUp(await info(interaction.guild, interaction.options.getString("id")));
    if (sub === "load") {
      return interaction.followUp(
        await load(interaction.guild, interaction.options.getString("id"), interaction.options.getBoolean("confirm"))
      );
    }
    if (sub === "delete") {
      return interaction.followUp(await remove(interaction.guild, interaction.options.getString("id")));
    }

    return interaction.followUp("Invalid subcommand");
  },
};

async function create(guild, authorId, name) {
  // A full channel list is needed, and the cache may be incomplete on a big server.
  await guild.channels.fetch().catch(() => {});
  await guild.roles.fetch().catch(() => {});

  const snapshot = snapshotGuild(guild);
  const backupId = newBackupId();

  await createBackup({
    guild_id: guild.id,
    backup_id: backupId,
    created_by: authorId,
    name: name ? name.slice(0, 60) : null,
    data: snapshot,
    counts: {
      roles: snapshot.roles.length,
      channels: snapshot.channels.filter((channel) => channel.type !== ChannelType.GuildCategory).length,
      categories: snapshot.channels.filter((channel) => channel.type === ChannelType.GuildCategory).length,
      emojis: snapshot.emojis.length,
    },
  });

  const pruned = await pruneBackups(guild.id, MAX_BACKUPS_PER_GUILD);

  return (
    `Snapshot \`${backupId}\` created: ${snapshot.roles.length} role(s), ${snapshot.channels.length} channel(s). ` +
    `${pruned ? `Removed ${pruned} old snapshot(s). ` : ""}Restore it with \`/backup load id:${backupId}\`.`
  );
}

async function list(guild) {
  const backups = await listBackups(guild.id);
  if (backups.length === 0) return "No snapshots yet. Create one with `/backup create`.";

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLORS.BOT_EMBED)
    .setAuthor({ name: `Backups · ${guild.name}` })
    .setDescription(
      backups
        .map(
          (backup) =>
            `\`${backup.backup_id}\`${backup.name ? ` · ${backup.name}` : ""} · ${time(new Date(backup.created_at), "R")}\n` +
            `-# ${backup.counts.roles} roles · ${backup.counts.categories} categories · ${backup.counts.channels} channels`
        )
        .join("\n\n")
    )
    .setFooter({ text: `${backups.length}/${MAX_BACKUPS_PER_GUILD} kept` });

  return { embeds: [embed] };
}

async function info(guild, backupId) {
  if (!backupId) return "Provide the snapshot id from `/backup list`.";

  const backup = await getBackup(guild.id, backupId);
  if (!backup) return "No snapshot with that id.";

  const snapshot = backup.data;
  const categories = snapshot.channels.filter((channel) => channel.type === ChannelType.GuildCategory);

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLORS.BOT_EMBED)
    .setAuthor({ name: `Backup ${backup.backup_id}` })
    .setDescription(
      [
        `**Server name at the time:** ${snapshot.guild.name}`,
        `**Taken:** ${time(new Date(backup.created_at), "F")}`,
        `**By:** ${backup.created_by ? `<@${backup.created_by}>` : "unknown"}`,
        "",
        `**Roles (${snapshot.roles.length}):** ${
          snapshot.roles
            .slice(0, 15)
            .map((role) => role.name)
            .join(", ") || "none"
        }`,
        `**Categories (${categories.length}):** ${
          categories
            .slice(0, 10)
            .map((category) => category.name)
            .join(", ") || "none"
        }`,
        `**Channels:** ${snapshot.channels.length - categories.length}`,
        `**Emojis:** ${snapshot.emojis.length}`,
      ]
        .join("\n")
        .slice(0, 4000)
    );

  return { embeds: [embed] };
}

async function load(guild, backupId, confirmed) {
  if (!backupId) return "Provide the snapshot id from `/backup list`.";

  const backup = await getBackup(guild.id, backupId);
  if (!backup) return "No snapshot with that id.";

  await guild.channels.fetch().catch(() => {});
  await guild.roles.fetch().catch(() => {});

  const plan = planRestore({
    snapshot: backup.data,
    existingRoles: [...guild.roles.cache.values()].map((role) => role.name),
    existingChannels: [...guild.channels.cache.values()].map((channel) => channel.name),
  });

  const total = plan.roles.length + plan.categories.length + plan.channels.length;
  if (total === 0) return "Nothing to restore: every role and channel of that snapshot already exists.";

  if (!confirmed) {
    return (
      `Restoring \`${backupId}\` would create **${plan.roles.length}** role(s), ` +
      `**${plan.categories.length}** category(ies) and **${plan.channels.length}** channel(s).\n` +
      "Nothing existing is renamed, moved or deleted. " +
      `Run \`/backup load id:${backupId} confirm:true\` to go ahead.`
    );
  }

  const created = await applyRestore({ guild, plan, reason: `Backup ${backupId} restored` });

  return (
    `Restored \`${backupId}\`: ${created.roles} role(s), ${created.categories} category(ies), ` +
    `${created.channels} channel(s).` +
    (created.failed.length ? `\nCould not create: ${created.failed.slice(0, 10).join(", ")}.` : "")
  );
}

async function remove(guild, backupId) {
  if (!backupId) return "Provide the snapshot id from `/backup list`.";

  const result = await deleteBackup(guild.id, backupId);
  return result.deletedCount ? `Snapshot \`${backupId}\` deleted.` : "No snapshot with that id.";
}
