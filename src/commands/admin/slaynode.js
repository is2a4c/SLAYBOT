const { ApplicationCommandOptionType, EmbedBuilder } = require("discord.js");
const models = require("@src/database/schemas/slaynode");
const { createEnrollment, rotateCredential } = require("@src/slaynode/control/server");
const { scoreGuild, DEFAULT_TIERS } = require("@src/slaynode/control/partner");
const { JOB_TYPES } = require("@src/slaynode/protocol");
const presenter = require("@src/slaynode/control/presenter");
const { EMBED_COLORS } = require("@root/config");

const NODE_ID_OPTION = { name: "node_id", description: "Node ID", type: ApplicationCommandOptionType.String, required: true };
const CREDIT_WINDOW_DAYS = 30;

module.exports = {
  name: "slaynode",
  description: "Manage SlayNode Partner workers for this server",
  category: "ADMIN",
  userPermissions: ["ManageGuild"],
  botPermissions: ["EmbedLinks"],
  command: { enabled: false },
  slashCommand: {
    enabled: true,
    ephemeral: true,
    options: [
      {
        name: "enroll",
        description: "Create a one-time enrollment token",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: "name", description: "Node name", type: ApplicationCommandOptionType.String, required: true, maxLength: 64 },
        ],
      },
      {
        name: "status",
        description: "Show nodes, credits and partner tier",
        type: ApplicationCommandOptionType.Subcommand,
      },
      {
        name: "leaderboard",
        description: "Rank your nodes by Slay Credits earned this season",
        type: ApplicationCommandOptionType.Subcommand,
      },
      {
        name: "privacy",
        description: "Configure private and general-pool jobs",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "guild_private",
            description: "Allow this guild content on its own nodes",
            type: ApplicationCommandOptionType.Boolean,
            required: true,
          },
          {
            name: "general_pool",
            description: "Allow eligible anonymized work in the general pool",
            type: ApplicationCommandOptionType.Boolean,
            required: true,
          },
        ],
      },
      {
        name: "revoke",
        description: "Permanently revoke a node",
        type: ApplicationCommandOptionType.Subcommand,
        options: [NODE_ID_OPTION],
      },
      {
        name: "rename",
        description: "Rename a node",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          NODE_ID_OPTION,
          { name: "name", description: "New name", type: ApplicationCommandOptionType.String, required: true, maxLength: 64 },
        ],
      },
      {
        name: "configure",
        description: "Set central resource and UTC schedule limits",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          NODE_ID_OPTION,
          {
            name: "parallelism",
            description: "Maximum concurrent jobs",
            type: ApplicationCommandOptionType.Integer,
            required: true,
            minValue: 1,
            maxValue: 16,
          },
          {
            name: "start_utc",
            description: "Start hour UTC (0-23)",
            type: ApplicationCommandOptionType.Integer,
            required: false,
            minValue: 0,
            maxValue: 23,
          },
          {
            name: "end_utc",
            description: "End hour UTC (0-23)",
            type: ApplicationCommandOptionType.Integer,
            required: false,
            minValue: 0,
            maxValue: 23,
          },
        ],
      },
      {
        name: "rotate",
        description: "Rotate a node credential",
        type: ApplicationCommandOptionType.Subcommand,
        options: [NODE_ID_OPTION],
      },
      {
        name: "audit",
        description: "Show recent safe SlayNode audit events",
        type: ApplicationCommandOptionType.Subcommand,
      },
    ],
  },
  async interactionRun(interaction) {
    if (!interaction.client.config.SLAYNODE?.enabled)
      return interaction.followUp({ embeds: [note(EMBED_COLORS.WARNING, "🛰️ SlayNode Partner is disabled by the operator.")] });

    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;
    const tiers = interaction.client.config.SLAYNODE.tiers || DEFAULT_TIERS;

    if (sub === "enroll") return handleEnroll(interaction, guildId);
    if (sub === "status") return handleStatus(interaction, guildId, tiers);
    if (sub === "leaderboard") return handleLeaderboard(interaction, guildId);
    if (sub === "privacy") return handlePrivacy(interaction, guildId);
    if (sub === "audit") return handleAudit(interaction, guildId);

    // Remaining subcommands act on a specific node owned by this guild.
    const nodeId = interaction.options.getString("node_id");
    const node = await models.Node.findOne({ nodeId, guildIds: guildId });
    if (!node) return interaction.followUp({ embeds: [note(EMBED_COLORS.ERROR, "❌ Node not found in this server.")] });
    if (sub === "revoke") return handleRevoke(interaction, node);
    if (sub === "rename") return handleRename(interaction, node);
    if (sub === "configure") return handleConfigure(interaction, node);
    if (sub === "rotate") return handleRotate(interaction, node);
  },
};

function base(color) {
  return new EmbedBuilder().setColor(color).setAuthor({ name: "SlayNode Partner" }).setTimestamp();
}
function note(color, description) {
  return base(color).setDescription(description);
}

async function handleEnroll(interaction, guildId) {
  const token = await createEnrollment({
    ownerId: interaction.user.id,
    guildId,
    name: interaction.options.getString("name"),
  });
  const embed = base(EMBED_COLORS.WARNING)
    .setTitle("🔗 One-time enrollment token")
    .setDescription(`\`\`\`\n${token}\n\`\`\``)
    .addFields({
      name: "Next step (on your worker machine)",
      value: `\`\`\`bash\nSLAYNODE_ENROLLMENT_TOKEN=<token> \\\nSLAYNODE_CONTROL_URL=https://your-control-host \\\nnpm run slaynode:enroll\n\`\`\``,
    })
    .setFooter({ text: "Expires in 15 minutes · shown once · keep it secret" });
  return interaction.followUp({ embeds: [embed] });
}

async function handleStatus(interaction, guildId, tiers) {
  const [scored, nodes, perNode] = await Promise.all([
    scoreGuild(guildId, tiers, CREDIT_WINDOW_DAYS),
    models.Node.find({ guildIds: guildId, status: { $ne: "REVOKED" } }).lean(),
    creditsByNode(guildId),
  ]);
  await models.GuildPartnerAccount.updateOne(
    { guildId },
    { $set: { tier: scored.tier, tierScore: scored.score, tierCalculatedAt: new Date() } },
    { upsert: true }
  );

  const meta = presenter.tierMeta(scored.tier);
  const progress = presenter.tierProgress(scored.score, scored.tier, tiers);
  const fleet = presenter.fleetSummary(nodes);
  const totalCredits = [...perNode.values()].reduce((sum, value) => sum + value, 0);

  const embed = base(meta.color)
    .setTitle(`${meta.emoji} Partner tier: ${scored.tier}`)
    .setDescription(
      [
        `**🪙 Slay Credits:** ${presenter.formatCredits(totalCredits)}`,
        progress.maxed
          ? "**Progress:** 💎 Max tier reached — top of the ladder."
          : `**To ${progress.next}:** ${progress.bar}\n_${progress.pointsToNext.toFixed(1)} points to go_`,
      ].join("\n\n")
    )
    .addFields(
      {
        name: "🖥️ Fleet",
        value: `${fleet.online}/${fleet.total} online · ${fleet.capacity} job slots · ${fleet.gpu} GPU\n${scored.accepted} accepted · ${scored.rejected} rejected (30d)`,
        inline: false,
      },
      {
        name: "📈 How to level up",
        value: `\`\`\`\n${presenter.componentBars(scored.components).join("\n")}\n\`\`\``,
        inline: false,
      },
      {
        name: `🔌 Nodes (${nodes.length})`,
        value: nodes.length
          ? nodes
              .slice(0, 10)
              .map((n) => presenter.nodeLine(n, perNode.get(n.nodeId) || 0))
              .join("\n")
          : "No nodes connected yet. Run `/slaynode enroll` to add one.",
        inline: false,
      }
    )
    .setFooter({ text: `Tier score ${scored.score.toFixed(1)}/100 · rolling 30-day window` });
  return interaction.followUp({ embeds: [embed] });
}

async function handleLeaderboard(interaction, guildId) {
  const [perNode, nodes] = await Promise.all([
    creditsByNode(guildId, CREDIT_WINDOW_DAYS),
    models.Node.find({ guildIds: guildId }).lean(),
  ]);
  const names = new Map(nodes.map((node) => [node.nodeId, node]));
  const ranked = [...perNode.entries()]
    .filter(([nodeId]) => nodeId)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  const medals = ["🥇", "🥈", "🥉"];
  const embed = base(EMBED_COLORS.GIVEAWAYS)
    .setTitle("🏆 Node leaderboard")
    .setFooter({ text: `Slay Credits earned in the last ${CREDIT_WINDOW_DAYS} days` });
  if (!ranked.length) {
    embed.setDescription("No credits earned yet this season. Keep your nodes online to climb the board!");
  } else {
    embed.setDescription(
      ranked
        .map(([nodeId, credits], index) => {
          const node = names.get(nodeId);
          const label = node ? node.name : `${nodeId.slice(0, 8)}…`;
          const rank = medals[index] || `\`#${index + 1}\``;
          const rel = node ? ` · ${(Math.max(0, Math.min(1, node.reliability)) * 100).toFixed(0)}% rel` : "";
          return `${rank} **${label}** — ${presenter.formatCredits(credits)} cr${rel}`;
        })
        .join("\n")
    );
  }
  return interaction.followUp({ embeds: [embed] });
}

async function handlePrivacy(interaction, guildId) {
  const policy = await models.PrivacyPolicy.findOneAndUpdate(
    { guildId },
    {
      $set: {
        allowGuildPrivate: interaction.options.getBoolean("guild_private"),
        allowGeneralPool: interaction.options.getBoolean("general_pool"),
        updatedBy: interaction.user.id,
      },
      $setOnInsert: { allowedJobTypes: Object.values(JOB_TYPES).filter((type) => type.startsWith("image.")) },
    },
    { upsert: true, new: true }
  );
  await models.Node.updateMany(
    { guildIds: guildId },
    policy.allowGuildPrivate
      ? { $addToSet: { privacyClasses: "GUILD_PRIVATE" } }
      : { $pull: { privacyClasses: "GUILD_PRIVATE" } }
  );
  const embed = base(EMBED_COLORS.SUCCESS)
    .setTitle("🔒 Privacy policy saved")
    .addFields(
      {
        name: `${policy.allowGuildPrivate ? "🟢" : "⚪"} Guild-private jobs`,
        value: policy.allowGuildPrivate
          ? "This server's private image content may run **only on its own bound nodes**."
          : "Private content stays on the central server.",
        inline: false,
      },
      {
        name: `${policy.allowGeneralPool ? "🟢" : "⚪"} General pool`,
        value: policy.allowGeneralPool
          ? "Anonymized, eligible work may be picked up by the shared pool."
          : "Your nodes only handle this server's own jobs.",
        inline: false,
      }
    );
  return interaction.followUp({ embeds: [embed] });
}

async function handleAudit(interaction, guildId) {
  const events = await models.AuditEvent.find({ guildId }).sort({ createdAt: -1 }).limit(10).lean();
  const embed = base(EMBED_COLORS.INFO).setTitle("📜 Recent SlayNode events");
  embed.setDescription(
    events.length
      ? events
          .map((event) => `\`${event.createdAt.toISOString().replace("T", " ").slice(0, 19)}\` — **${event.action}** · ${event.outcome || "OK"}`)
          .join("\n")
      : "No audit events recorded yet."
  );
  return interaction.followUp({ embeds: [embed] });
}

async function handleRevoke(interaction, node) {
  node.status = "REVOKED";
  node.revokedAt = new Date();
  node.credentialEncrypted = undefined;
  await node.save();
  return interaction.followUp({
    embeds: [note(EMBED_COLORS.ERROR, `⛔ Node **${node.name}** (\`${node.nodeId}\`) has been permanently revoked.`)],
  });
}

async function handleRename(interaction, node) {
  node.name = interaction.options.getString("name").replace(/[^\w .-]/g, "").slice(0, 64);
  await node.save();
  return interaction.followUp({ embeds: [note(EMBED_COLORS.SUCCESS, `✏️ Node renamed to **${node.name}**.`)] });
}

async function handleConfigure(interaction, node) {
  const start = interaction.options.getInteger("start_utc");
  const end = interaction.options.getInteger("end_utc");
  if ((start === null) !== (end === null))
    return interaction.followUp({ embeds: [note(EMBED_COLORS.WARNING, "⚠️ Provide both start_utc and end_utc, or neither.")] });
  node.limits = { ...node.limits, parallelism: interaction.options.getInteger("parallelism") };
  node.schedule = { enabled: start !== null, startHourUtc: start, endHourUtc: end };
  await node.save();
  const embed = base(EMBED_COLORS.SUCCESS)
    .setTitle("⚙️ Limits saved")
    .addFields(
      { name: "Parallelism", value: `${node.limits.parallelism} concurrent jobs`, inline: true },
      { name: "Schedule (UTC)", value: start === null ? "Always on" : `${start}:00 – ${end}:00`, inline: true }
    );
  return interaction.followUp({ embeds: [embed] });
}

async function handleRotate(interaction, node) {
  const secret = await rotateCredential(node.nodeId);
  const embed = base(EMBED_COLORS.WARNING)
    .setTitle("🔑 New node secret")
    .setDescription(`\`\`\`\n${secret}\n\`\`\``)
    .setFooter({ text: "Shown once · update SLAYNODE_SECRET on the worker and restart it" });
  return interaction.followUp({ embeds: [embed] });
}

// Sum credits per node for a guild, optionally within a rolling window (days).
async function creditsByNode(guildId, windowDays) {
  const match = { guildId };
  if (windowDays) match.createdAt = { $gte: new Date(Date.now() - windowDays * 86400_000) };
  const rows = await models.CreditLedgerEntry.aggregate([
    { $match: match },
    { $group: { _id: "$nodeId", total: { $sum: "$amountMicros" } } },
  ]);
  return new Map(rows.map((row) => [row._id, row.total]));
}
