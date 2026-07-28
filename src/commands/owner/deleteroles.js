const MAIN_GUILD_ID = "1229090248273957046";

const ROLES_TO_DELETE = [
  "┗⎯⎯⎯⎯⎯⎯|🎨| COLOR |🎨|⎯⎯⎯⎯⎯⎯┑",
  "\u{1F90D} | White",
  "🖤 | Black",
  "💜 | Purple",
  "💙 | Blue",
  "💚 | Green",
  "💛 | Yellow",
  "\u{1F9E1} | Orange",
  "❤️ | Red",
  "┗⎯⎯⎯⎯⎯|🔸| STAFF TEAM |🔸|⎯⎯⎯⎯⎯┑",
  "🎓| Admin",
  "💼| Manager",
  "🔒 | Moderator",
  "📄 | Partner",
  "┗⎯⎯⎯⎯⎯|🔸| SAPPORT TEAM |🔸|⎯⎯⎯⎯⎯┑",
  "🎓| Helper",
  "┗⎯⎯⎯⎯⎯|🔸| DEVELOPER TEAM |🔸|⎯⎯⎯⎯⎯┑",
  "📞| Hosting",
  "🛠 | Developer",
  "✏️ | Designer",
  "┗⎯⎯⎯⎯⎯⎯|🔹| BLOGERS |🔹|⎯⎯⎯⎯⎯⎯┑",
  "🎥 | Youtuber",
  "┗⎯⎯⎯⎯⎯⎯⎯|🔹| OTHER |🔹|⎯⎯⎯⎯⎯⎯⎯┑",
  "🤖| BOTS",
  "😎| LEGEND",
  "🔥 | MEMBER",
  "📢| News",
  "🎉| Events",
  "🎶 | Music",
  "📊 | Economy",
  "Premium Members",
  "Supporter",
  "Supporter +",
  "Super Supporter",
  "Early Access Pass",
];

/**
 * @type {import("@structures/Command")}
 */
module.exports = {
  name: "deleteroles",
  description: "delete a predefined list of roles from the main server",
  category: "OWNER",
  command: {
    enabled: true,
  },
  slashCommand: {
    enabled: false,
  },

  async messageRun(message) {
    const guild = message.client.guilds.cache.get(MAIN_GUILD_ID);
    if (!guild) {
      return message.safeReply("Main server not found or bot is not in it.");
    }

    await message.safeReply(`Starting role cleanup on **${guild.name}**...`);

    const deleted = [];
    const notFound = [];
    const failed = [];

    for (const roleName of ROLES_TO_DELETE) {
      const role = guild.roles.cache.find((r) => r.name === roleName);
      if (!role) {
        notFound.push(roleName);
        continue;
      }

      try {
        await role.delete("Owner cleanup command");
        deleted.push(roleName);
      } catch {
        failed.push(roleName);
      }
    }

    const lines = [];
    if (deleted.length > 0) lines.push(`✅ Deleted (${deleted.length}): ${deleted.map((n) => `\`${n}\``).join(", ")}`);
    if (notFound.length > 0)
      lines.push(`⚠️ Not found (${notFound.length}): ${notFound.map((n) => `\`${n}\``).join(", ")}`);
    if (failed.length > 0) lines.push(`❌ Failed (${failed.length}): ${failed.map((n) => `\`${n}\``).join(", ")}`);

    const result = lines.join("\n\n").slice(0, 1900) || "Nothing to do.";
    return message.safeReply(result);
  },
};
