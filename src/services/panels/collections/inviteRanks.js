const { defineCollectionPanel } = require("../collectionPanel");
const { HOME_ID } = require("../ids");

/**
 * Roles handed out for bringing people in.
 *
 * A reward is a role and the number of invites that earns it. The tracker gives
 * it out on its own; this is where a server says which roles those are.
 */

const MAX_RANKS = 25;

const fields = [
  { id: "role", nameKey: "panels.inviteranks.fields.role", emoji: "🎁", type: "role", required: true },
  {
    id: "invites",
    nameKey: "panels.inviteranks.fields.invites",
    emoji: "🔢",
    type: "number",
    required: true,
    min: 1,
    max: 1000,
  },
];

const listOf = (settings) => settings?.invite?.ranks || [];
const roleOf = (rank) => String(rank?._id || "");

module.exports = defineCollectionPanel({
  id: "CFG_INVRANK",
  icon: "🎁",
  titleKey: "panels.inviteranks.title",
  descriptionKey: "panels.inviteranks.description",
  emptyKey: "panels.inviteranks.empty",
  hintKey: "panels.inviteranks.hint",
  max: MAX_RANKS,
  homeId: HOME_ID,
  fields,

  list: async (guild, settings) => listOf(settings),
  keyOf: (rank) => roleOf(rank),
  summarise: (rank, t) => t("panels.inviteranks.summary", { invites: rank.invites }),

  describe: (rank, t) => `🎁 <@&${roleOf(rank)}> — ${t("panels.inviteranks.summary", { invites: rank.invites })}`,

  toValues: (rank) => ({ role: roleOf(rank), invites: rank.invites }),

  async create({ settings, values, t }) {
    if (listOf(settings).some((rank) => roleOf(rank) === values.role)) {
      return { ok: false, message: t("panels.inviteranks.exists") };
    }

    settings.invite.ranks.push({ _id: values.role, invites: values.invites });
    await settings.save();

    return { ok: true, message: t("panels.inviteranks.added") };
  },

  async update({ settings, key, values, t }) {
    const rank = listOf(settings).find((entry) => roleOf(entry) === key);
    if (!rank) return { ok: false, message: t("collections.gone") };

    if (values.role !== key && listOf(settings).some((entry) => roleOf(entry) === values.role)) {
      return { ok: false, message: t("panels.inviteranks.exists") };
    }

    // The role is the reward's identity, so pointing one at another role is a new
    // entry in the same place rather than an edit of the old one.
    const index = listOf(settings).findIndex((entry) => roleOf(entry) === key);
    settings.invite.ranks.splice(index, 1, { _id: values.role, invites: values.invites });
    await settings.save();

    return { ok: true, message: t("panels.inviteranks.saved") };
  },

  async remove({ settings, key, t }) {
    const index = listOf(settings).findIndex((entry) => roleOf(entry) === key);
    if (index === -1) return { ok: false, message: t("collections.gone") };

    settings.invite.ranks.splice(index, 1);
    await settings.save();

    return { ok: true, message: t("panels.inviteranks.removed") };
  },
});
