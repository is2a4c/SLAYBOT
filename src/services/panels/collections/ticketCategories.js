const { ChannelType } = require("discord.js");
const { defineCollectionPanel } = require("../collectionPanel");
const { HOME_ID } = require("../ids");

/**
 * The kinds of ticket a server takes.
 *
 * A category is what the member picks when opening a ticket: it decides who is
 * pulled into the thread and where the notification lands. They were set by
 * command until now, which is why a server could have four of them and see none
 * of it in the panel.
 */

const TEXT_CHANNELS = [ChannelType.GuildText, ChannelType.GuildAnnouncement];

// What the menu a member picks from can hold.
const MAX_CATEGORIES = 25;

const fields = [
  {
    id: "name",
    nameKey: "panels.ticketcategories.fields.name",
    emoji: "✏️",
    type: "text",
    required: true,
    maxLength: 40,
    example: "Help",
  },
  { id: "staff", nameKey: "panels.ticketcategories.fields.staff", emoji: "👥", type: "roleList", max: 10 },
  {
    id: "notify",
    nameKey: "panels.ticketcategories.fields.notify",
    emoji: "🔔",
    type: "channel",
    channelTypes: TEXT_CHANNELS,
  },
];

/** The categories a server has, whatever the rest of the ticket settings hold. */
const listOf = (settings) => settings?.ticket?.categories || [];

const nameOf = (category) => String(category?.name || "").trim();

module.exports = defineCollectionPanel({
  id: "CFG_TICKETCAT",
  icon: "🗂️",
  titleKey: "panels.ticketcategories.title",
  descriptionKey: "panels.ticketcategories.description",
  emptyKey: "panels.ticketcategories.empty",
  hintKey: "panels.ticketcategories.hint",
  max: MAX_CATEGORIES,
  homeId: HOME_ID,
  fields,

  list: async (guild, settings) => listOf(settings),
  keyOf: (category) => nameOf(category),
  summarise: (category) => nameOf(category) || "—",

  describe: (category, t) =>
    [
      `🗂️ **${nameOf(category) || "—"}**` +
        (category.notification_channel ? ` → <#${category.notification_channel}>` : ""),
      `-# ${
        category.staff_roles?.length
          ? category.staff_roles.map((id) => `<@&${id}>`).join(" · ")
          : t("panels.ticketcategories.noStaff")
      }`,
    ].join("\n"),

  toValues: (category) => ({
    name: nameOf(category),
    staff: [...(category.staff_roles || [])],
    notify: category.notification_channel || null,
  }),

  async create({ settings, values, t }) {
    if (listOf(settings).some((category) => nameOf(category) === values.name.trim())) {
      return { ok: false, message: t("panels.ticketcategories.exists") };
    }

    settings.ticket.categories.push({
      name: values.name.trim(),
      staff_roles: values.staff || [],
      notification_channel: values.notify || null,
    });
    await settings.save();

    return { ok: true, message: t("panels.ticketcategories.added", { name: values.name.trim() }) };
  },

  async update({ settings, key, values, t }) {
    const category = listOf(settings).find((entry) => nameOf(entry) === key);
    if (!category) return { ok: false, message: t("collections.gone") };

    const renamed = values.name.trim();
    if (renamed !== key && listOf(settings).some((entry) => nameOf(entry) === renamed)) {
      return { ok: false, message: t("panels.ticketcategories.exists") };
    }

    category.name = renamed;
    category.staff_roles = values.staff || [];
    category.notification_channel = values.notify || null;
    await settings.save();

    return { ok: true, message: t("panels.ticketcategories.saved", { name: renamed }) };
  },

  async remove({ settings, key, t }) {
    const index = listOf(settings).findIndex((entry) => nameOf(entry) === key);
    if (index === -1) return { ok: false, message: t("collections.gone") };

    settings.ticket.categories.splice(index, 1);
    await settings.save();

    return { ok: true, message: t("panels.ticketcategories.removed") };
  },
});
