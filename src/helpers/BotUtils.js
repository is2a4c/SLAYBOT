const { success, warn, debug } = require("@helpers/Logger");
const { execSync } = require("child_process");

module.exports = class BotUtils {
  /**
   * Check if the bot is up to date
   */
  static async checkForUpdates() {
    try {
      const tags = execSync("git ls-remote --tags --sort=-v:refname https://github.com/PashaBritva/SLAYBOT.git", {
        encoding: "utf8",
        timeout: 10000,
      });
      const latestTag = tags.match(/refs\/tags\/v?([\d.]+)/)?.[1];
      if (!latestTag) return;
      if (require("@root/package.json").version.replace(/[^0-9]/g, "") >= latestTag.replace(/[^0-9]/g, "")) {
        success("VersionCheck: Your discord bot is up to date");
      } else {
        warn(`VersionCheck: v${latestTag} update is available`);
        warn("download: https://github.com/PashaBritva/SLAYBOT/releases/latest");
      }
    } catch {
      debug("VersionCheck: Could not check for updates");
    }
  }

  /**
   * Get the image url from the message
   * @param {import('discord.js').Message} message
   * @param {string[]} args
   */
  static async getImageFromMessage(message, args) {
    let url;

    // check for attachments
    if (message.attachments.size > 0) {
      const attachment = message.attachments.first();
      const attachUrl = attachment.url;
      const attachIsImage = attachUrl.endsWith(".png") || attachUrl.endsWith(".jpg") || attachUrl.endsWith(".jpeg");
      if (attachIsImage) url = attachUrl;
    }

    if (!url && args.length === 0) url = message.author.displayAvatarURL({ size: 256, extension: "png" });

    if (!url && args.length !== 0) {
      try {
        url = new URL(args[0]).href;
      } catch (ex) {
        /* Ignore */
      }
    }

    if (!url && message.mentions.users.size > 0) {
      url = message.mentions.users.first().displayAvatarURL({ size: 256, extension: "png" });
    }

    if (!url) {
      const member = await message.guild.resolveMember(args[0]);
      if (member) url = member.user.displayAvatarURL({ size: 256, extension: "png" });
    }

    if (!url) url = message.author.displayAvatarURL({ size: 256, extension: "png" });

    return url;
  }

  static get musicValidations() {
    return [
      {
        callback: ({ client, guildId }) => client.musicManager?.getPlayer(guildId),
        message: "🚫 No music is being played!",
      },
      {
        callback: ({ member }) => member.voice?.channelId,
        message: "🚫 You need to join my voice channel.",
      },
      {
        callback: ({ member, client, guildId }) =>
          member.voice?.channelId === client.musicManager?.getPlayer(guildId)?.channelId,
        message: "🚫 You're not in the same voice channel.",
      },
    ];
  }
};
