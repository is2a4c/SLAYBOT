const { ChannelType } = require("discord.js");
const { defineCollectionPanel } = require("../collectionPanel");
const { HOME_ID } = require("../ids");

/**
 * The voice channels that show how many people are on the server.
 *
 * A counter is a name and a kind; the channel behind it is the bot's business,
 * created when the counter is added and deleted with it. Renaming one renames the
 * channel on the spot rather than waiting for the next refresh.
 */

const TYPES = ["USERS", "MEMBERS", "BOTS"];
const TYPE_ICONS = { USERS: "👥", MEMBERS: "🙋", BOTS: "🤖" };

const fields = [
  {
    id: "type",
    nameKey: "panels.counters.fields.type",
    emoji: "🧩",
    type: "choice",
    required: true,
    choices: TYPES,
    choiceLabels: {
      USERS: "users",
      MEMBERS: "members",
      BOTS: "bots",
    },
  },
  {
    id: "name",
    nameKey: "panels.counters.fields.name",
    emoji: "✏️",
    type: "text",
    required: true,
    maxLength: 80,
    example: "Members",
  },
];

/**
 * What the channel is called: the name, then the number it is counting.
 *
 * @param {import('discord.js').Guild} guild
 * @param {string} type
 * @param {string} name
 * @param {number[]} stats [all, bots, members]
 */
/**
 * The kind a stored counter counts, whatever shape it was written in.
 *
 * @param {object} counter
 */
function kindOf(counter) {
  return String(counter?.counter_type || "").toUpperCase();
}

function channelName(type, name, stats) {
  const [all, bots, members] = stats;
  const count = type === "USERS" ? all : type === "BOTS" ? bots : members;
  return `${name} : ${count}`;
}

module.exports = defineCollectionPanel({
  id: "CFG_COUNTERS",
  icon: "🔢",
  titleKey: "panels.counters.title",
  descriptionKey: "panels.counters.description",
  emptyKey: "panels.counters.empty",
  hintKey: "panels.counters.hint",
  max: TYPES.length,
  homeId: HOME_ID,
  fields,

  list: async (guild, settings) => settings.counters || [],
  keyOf: (counter) => kindOf(counter),
  summarise: (counter) => `${kindOf(counter).toLowerCase()} · ${counter.name || "—"}`,

  describe: (counter) =>
    `${TYPE_ICONS[kindOf(counter)] || "🔢"} **${kindOf(counter).toLowerCase()}** ` +
    `\`${counter.name || "—"}\` → <#${counter.channel_id}>`,

  toValues: (counter) => ({ type: TYPES.includes(kindOf(counter)) ? kindOf(counter) : null, name: counter.name }),

  async create({ guild, settings, values, t }) {
    const type = values.type;
    if (settings.counters.some((counter) => counter.counter_type.toUpperCase() === type)) {
      return { ok: false, message: t("panels.counters.exists") };
    }

    if (!guild.members.me.permissions.has("ManageChannels")) {
      return { ok: false, message: t("panels.counters.noPermission") };
    }

    const stats = await guild.fetchMemberStats();
    const channel = await guild.channels
      .create({
        name: channelName(type, values.name, stats),
        type: ChannelType.GuildVoice,
        permissionOverwrites: [
          { id: guild.roles.everyone, deny: ["Connect"] },
          { id: guild.members.me.id, allow: ["ViewChannel", "ManageChannels", "Connect"] },
        ],
      })
      .catch(() => null);

    if (!channel) return { ok: false, message: t("panels.counters.noPermission") };

    settings.counters.push({ counter_type: type, channel_id: channel.id, name: values.name });
    settings.data.bots = stats[1];
    await settings.save();

    return { ok: true, message: t("panels.counters.added", { channel: channel.toString() }) };
  },

  async update({ guild, settings, key, values, t }) {
    const counter = settings.counters.find((entry) => entry.counter_type.toUpperCase() === key);
    if (!counter) return { ok: false, message: t("collections.gone") };

    // The kind is what the channel counts, and one channel counts one thing; a
    // different kind is a different counter.
    if (values.type !== key && settings.counters.some((entry) => entry.counter_type.toUpperCase() === values.type)) {
      return { ok: false, message: t("panels.counters.exists") };
    }

    counter.counter_type = values.type;
    counter.name = values.name;
    await settings.save();

    const stats = await guild.fetchMemberStats();
    const channel = guild.channels.cache.get(counter.channel_id);
    if (channel?.manageable) await channel.setName(channelName(values.type, values.name, stats)).catch(() => {});

    return { ok: true, message: t("panels.counters.saved") };
  },

  async remove({ guild, settings, key, t }) {
    const index = settings.counters.findIndex((entry) => entry.counter_type.toUpperCase() === key);
    if (index === -1) return { ok: false, message: t("collections.gone") };

    const [counter] = settings.counters.splice(index, 1);
    await settings.save();

    // The channel exists only to show this counter, so it goes with it.
    const channel = guild.channels.cache.get(counter.channel_id);
    await channel?.delete("Counter removed from the panel").catch(() => {});

    return { ok: true, message: t("panels.counters.removed") };
  },
});
