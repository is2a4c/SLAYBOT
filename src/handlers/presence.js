const { ActivityType } = require("discord.js");

let messageIndex = 0;
let presenceTimer;
const VALID_STATUSES = new Set(["online", "idle", "dnd", "invisible"]);

/**
 * @param {import('@src/structures').BotClient} client
 */
function updatePresence(client) {
  const presence = client.config.PRESENCE;
  const messages = Array.isArray(presence.MESSAGE)
    ? presence.MESSAGE.filter((item) => item !== null && item !== undefined && String(item).trim() !== "")
    : presence.MESSAGE
      ? [presence.MESSAGE]
      : [];

  let message = messages.length > 0 ? messages[messageIndex] : null;
  if (message !== null && typeof message !== "string") message = String(message);

  if (message?.includes("{servers}")) {
    message = message.replaceAll("{servers}", client.guilds.cache.size);
  }

  if (message?.includes("{members}")) {
    const members = client.guilds.cache.map((g) => g.memberCount).reduce((partial_sum, a) => partial_sum + a, 0);
    message = message.replaceAll("{members}", members);
  }

  const getType = (type) => {
    switch (type) {
      case "COMPETING":
        return ActivityType.Competing;

      case "LISTENING":
        return ActivityType.Listening;

      case "PLAYING":
        return ActivityType.Playing;

      case "WATCHING":
        return ActivityType.Watching;

      case "CUSTOM":
        return ActivityType.Custom;

      default:
        return ActivityType.Playing;
    }
  };

  const status = VALID_STATUSES.has(presence.STATUS) ? presence.STATUS : "idle";
  const activities = message
    ? [
        {
          name: message,
          ...(presence.TYPE === "CUSTOM" ? { state: message } : {}),
          type: getType(presence.TYPE),
        },
      ]
    : [];

  client.user.setPresence({ status, activities });

  if (messages.length > 0) {
    messageIndex = (messageIndex + 1) % messages.length;
  }
}

function handlePresence(client) {
  updatePresence(client);
  if (!presenceTimer) {
    presenceTimer = setInterval(() => updatePresence(client), 10 * 60 * 1000);
  }
}

module.exports = handlePresence;
module.exports.updatePresence = updatePresence;
