const { ChannelType } = require("discord.js");
const { defineCollectionPanel } = require("../collectionPanel");
const { HOME_ID } = require("../ids");

/**
 * A role for sitting in one particular voice channel.
 *
 * The system's own switch and the role everybody in voice gets live on the voice
 * roles panel; this is the list of exceptions — this channel, that role.
 */

const VOICE_CHANNELS = [ChannelType.GuildVoice, ChannelType.GuildStageVoice];

const fields = [
  {
    id: "channel",
    nameKey: "panels.voicechannels.fields.channel",
    emoji: "🔊",
    type: "channel",
    required: true,
    channelTypes: VOICE_CHANNELS,
  },
  { id: "role", nameKey: "panels.voicechannels.fields.role", emoji: "🎭", type: "role", required: true },
];

const listOf = (settings) => settings?.voice_roles?.channels || [];

module.exports = defineCollectionPanel({
  id: "CFG_VOICECH",
  icon: "🔊",
  titleKey: "panels.voicechannels.title",
  descriptionKey: "panels.voicechannels.description",
  emptyKey: "panels.voicechannels.empty",
  hintKey: "panels.voicechannels.hint",
  homeId: HOME_ID,
  fields,

  list: async (guild, settings) => listOf(settings),
  keyOf: (entry) => String(entry?.channel_id || ""),
  summarise: (entry, t, guild) => guild?.channels?.cache?.get(entry.channel_id)?.name || String(entry.channel_id),

  describe: (entry) => `🔊 <#${entry.channel_id}> → <@&${entry.role_id}>`,

  toValues: (entry) => ({ channel: entry.channel_id, role: entry.role_id }),

  async create({ settings, values, t }) {
    if (listOf(settings).some((entry) => String(entry.channel_id) === values.channel)) {
      return { ok: false, message: t("panels.voicechannels.exists") };
    }

    settings.voice_roles.channels.push({ channel_id: values.channel, role_id: values.role });
    await settings.save();

    return { ok: true, message: t("panels.voicechannels.added") };
  },

  async update({ settings, key, values, t }) {
    const index = listOf(settings).findIndex((entry) => String(entry.channel_id) === key);
    if (index === -1) return { ok: false, message: t("collections.gone") };

    const taken = listOf(settings).some((entry, at) => at !== index && String(entry.channel_id) === values.channel);
    if (taken) return { ok: false, message: t("panels.voicechannels.exists") };

    const entry = listOf(settings)[index];
    entry.channel_id = values.channel;
    entry.role_id = values.role;
    await settings.save();

    return { ok: true, message: t("panels.voicechannels.saved") };
  },

  async remove({ settings, key, t }) {
    const index = listOf(settings).findIndex((entry) => String(entry.channel_id) === key);
    if (index === -1) return { ok: false, message: t("collections.gone") };

    settings.voice_roles.channels.splice(index, 1);
    await settings.save();

    return { ok: true, message: t("panels.voicechannels.removed") };
  },
});
