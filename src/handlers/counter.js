const { getSettings } = require("@schemas/Guild");

/**
 * Updates the counter channel for all the guildId's present in the update queue
 * @param {import('@src/structures').BotClient} client
 */
async function updateCounterChannels(client) {
  // Taken off the queue in one go: the entries are worked through one after the
  // other, and anything queued while that happens belongs to the next run. The
  // old code walked the queue and spliced out of it as it went, so a server the
  // bot had left was never removed and every later run tried it again.
  const pending = client.counterUpdateQueue.splice(0, client.counterUpdateQueue.length);

  for (const guildId of pending) {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) continue;

    try {
      const settings = await getSettings(guild);

      const all = guild.memberCount;
      const bots = settings.data.bots || 0;
      const members = all - bots;

      for (const config of settings.counters) {
        const chId = config.channel_id;
        const vc = guild.channels.cache.get(chId);
        if (!vc) continue;

        const counts = { USERS: all, MEMBERS: members, BOTS: bots };
        const count = counts[config.counter_type.toUpperCase()];
        // A kind nothing counts would have renamed the channel to "undefined".
        if (count === undefined) continue;

        if (vc.manageable) {
          await vc.setName(`${config.name} : ${count}`).catch((err) => vc.client.logger.log("Set Name error: ", err));
        }
      }
    } catch (ex) {
      client.logger.error(`Error updating counter channels for guildId: ${guildId}`, ex);
    }
  }
}

/**
 * Initialize guild counters at startup
 * @param {import("discord.js").Guild} guild
 * @param {Object} settings
 */
async function init(guild, settings) {
  if (settings.counters.find((doc) => ["MEMBERS", "BOTS"].includes(doc.counter_type.toUpperCase()))) {
    const stats = await guild.fetchMemberStats();
    settings.data.bots = stats[1]; // update bot count in database
    await settings.save();
  }

  // schedule for update
  if (!guild.client.counterUpdateQueue.includes(guild.id)) guild.client.counterUpdateQueue.push(guild.id);
  return true;
}

module.exports = { init, updateCounterChannels };
