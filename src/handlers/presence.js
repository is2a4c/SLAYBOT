const { ActivityType } = require("discord.js");

let messageIndex = 0;
const VALID_STATUSES = new Set(["online", "idle", "dnd", "invisible"]);

/**
 * @param {import('@src/structures').BotClient} client
 */
function updatePresence(client) {
  const presence = client.config.PRESENCE;
  const messages = Array.isArray(presence.MESSAGE) && presence.MESSAGE.length > 0 ? presence.MESSAGE : ["SLAYBOT"];
  let message = Array.isArray(messages) ? messages[messageIndex] : messages;
  if (typeof message !== "string") message = String(message || "SLAYBOT");

  if (message.includes("{servers}")) {
    message = message.replaceAll("{servers}", client.guilds.cache.size);
  }

  if (message.includes("{members}")) {
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

  if (presence.TYPE === "CUSTOM") {
    client.user.setPresence({
      status,
      activities: [
        {
          name: message,
          state: message,
          type: getType(presence.TYPE),
        },
      ],
    });
  } else {
    client.user.setPresence({
      status,
      activities: [
        {
          name: message,
          type: getType(presence.TYPE),
        },
      ],
    });
  }

  if (Array.isArray(messages)) {
    messageIndex = (messageIndex + 1) % messages.length;
  }
}

module.exports = function handlePresence(client) {
  updatePresence(client);
  setInterval(() => updatePresence(client), 10 * 60 * 1000);
};
