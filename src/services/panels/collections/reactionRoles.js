const { ChannelType } = require("discord.js");
const { listGuildReactionRoles, removeReactionRole } = require("@schemas/ReactionRoles");
const { MAX_REACTION_ROLES } = require("@helpers/ReactionRoleMappings");
const { applyReactionRoles, formatReactionRoles, showEmote } = require("@src/services/roles/ReactionRoleSetup");
const { defineCollectionPanel } = require("../collectionPanel");
const { HOME_ID } = require("../ids");

/**
 * Reaction roles, one entry per message they are attached to.
 *
 * The pairs stay one text box — an emoji and a role, separated by commas — because
 * that is how they are read and how they are checked; the panel's job is to keep
 * the message they belong to, show what is currently on it, and put the pairs
 * back in the box when they are edited.
 */

const KEY_SEPARATOR = "-";
const TEXT_CHANNELS = [ChannelType.GuildText, ChannelType.GuildAnnouncement];

const fields = [
  {
    id: "channel",
    nameKey: "panels.reactionroles.fields.channel",
    emoji: "📢",
    type: "channel",
    required: true,
    channelTypes: TEXT_CHANNELS,
  },
  {
    id: "message",
    nameKey: "panels.reactionroles.fields.message",
    emoji: "🆔",
    type: "text",
    required: true,
    maxLength: 20,
    example: "1234567890123456789",
  },
  {
    id: "pairs",
    nameKey: "panels.reactionroles.fields.pairs",
    emoji: "🎭",
    type: "text",
    required: true,
    long: true,
    maxLength: 1000,
    example: "😀 @Member, 🎮 @Gamer",
  },
];

const keyOf = (entry) => `${entry.channel_id}${KEY_SEPARATOR}${entry.message_id}`;
const split = (key) => {
  const [channelId, messageId] = String(key).split(KEY_SEPARATOR);
  return { channelId, messageId };
};

/**
 * Store a set of pairs, and take the previous message's set down when the entry
 * has been pointed at a different message.
 *
 * @param {Object} context
 */
async function put({ guild, key, values, t }) {
  const channel = guild.channels.cache.get(values.channel);
  if (!channel?.isTextBased?.()) return { ok: false, message: t("panels.reactionroles.badChannel") };

  const { ok, key: outcome, vars } = await applyReactionRoles(guild, channel, values.message, values.pairs);

  if (ok && key && key !== "+") {
    const previous = split(key);
    if (previous.channelId !== values.channel || previous.messageId !== values.message) {
      await removeReactionRole(guild.id, previous.channelId, previous.messageId);
    }
  }

  return { ok, message: t(outcome, vars) };
}

module.exports = defineCollectionPanel({
  id: "CFG_RR",
  icon: "🎭",
  titleKey: "panels.reactionroles.title",
  descriptionKey: "panels.reactionroles.description",
  emptyKey: "panels.reactionroles.empty",
  hintKey: "panels.reactionroles.hint",
  homeId: HOME_ID,
  fields,

  list: (guild) => listGuildReactionRoles(guild.id),
  keyOf,
  summarise: (entry, t) => t("panels.reactionroles.summary", { count: entry.roles.length, message: entry.message_id }),

  describe: (entry, t, guild) =>
    [
      `🎭 <#${entry.channel_id}> · \`${entry.message_id}\` · ` +
        t("panels.reactionroles.pairCount", { count: entry.roles.length, max: MAX_REACTION_ROLES }),
      `-# ${entry.roles.map((role) => `${showEmote(guild, role.emote)} <@&${role.role_id}>`).join(" · ") || "—"}`,
    ].join("\n"),

  toValues: (entry, guild) => ({
    channel: entry.channel_id,
    message: entry.message_id,
    // Written back out the way they are typed in, so editing one pair does not
    // mean retyping the rest from the message itself.
    pairs: formatReactionRoles(guild, entry.roles),
  }),

  create: (context) => put({ ...context, key: null }),
  update: (context) => put(context),

  async remove({ guild, key, t }) {
    const { channelId, messageId } = split(key);
    await removeReactionRole(guild.id, channelId, messageId);

    // The bot's own reactions are what people click, so they go too.
    const channel = guild.channels.cache.get(channelId);
    const message = await channel?.messages?.fetch(messageId).catch(() => null);
    if (message) {
      await Promise.all(
        message.reactions.cache.map((reaction) => reaction.users.remove(guild.members.me.id).catch(() => {}))
      );
    }

    return { ok: true, message: t("panels.reactionroles.removed") };
  },
});
