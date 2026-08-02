const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder } = require("discord.js");
const { EMBED_COLORS } = require("@root/config");
const { applyBranding, resolveBranding } = require("@helpers/Branding");
const draft = require("./draft");
const editor = require("./fieldEditor");
const { ack, redraw, slowRedraw, warn } = require("./reply");

/**
 * A settings panel for things a server has several of.
 *
 * Feeds, counters, sticky messages and reaction roles are not one setting each —
 * they are lists of entries, and a panel of toggles cannot express "add another
 * one". This builds the missing shape: a list, an entry, and the same field
 * editor the other panels use for the entry's own settings.
 *
 * Three screens, in one message:
 *
 *   <ID>:list          what the server has, and a menu to open one
 *   <ID>:new           an empty entry being filled in
 *   <ID>:open:<key>    an entry that exists
 *
 * Everything typed or picked goes into a draft first, and only a deliberate press
 * of Save or Create writes it: creating a feed reaches out to the source, and a
 * sticky message is re-posted, so neither should happen halfway through editing.
 */

const NEW = "+";
const SELECT_MARK = "~SEL";
const MODAL_MARK = "~MOD";

/**
 * @param {() => string} read
 * @param {string} fallback
 */
function safely(read, fallback) {
  try {
    const value = read();
    return value === undefined || value === null || value === "" ? fallback : value;
  } catch {
    return fallback;
  }
}

/**
 * @param {Object} definition
 * @param {string} definition.id custom id namespace, uppercase
 * @param {string} definition.icon
 * @param {string} definition.titleKey
 * @param {string} definition.descriptionKey
 * @param {string} definition.emptyKey what to say when the list is empty
 * @param {string} definition.hintKey
 * @param {string} [definition.homeId] the "back to the hub" button
 * @param {number} [definition.max] how many entries a server may have
 * @param {object[]} definition.fields what one entry is made of
 * @param {(guild: object) => Promise<object[]>} definition.list
 * @param {(entry: object) => string} definition.keyOf identifier used in custom ids
 * @param {(entry: object, t: Function) => string} definition.describe one line in the list
 * @param {(entry: object, t: Function) => string} definition.summarise label in the menu
 * @param {(entry: object) => object} definition.toValues entry → editable values
 * @param {(context: object) => Promise<{ok: boolean, message: string}>} definition.create
 * @param {(context: object) => Promise<{ok: boolean, message: string}>} definition.update
 * @param {(context: object) => Promise<{ok: boolean, message: string}>} definition.remove
 */
function defineCollectionPanel(definition) {
  const {
    id,
    icon,
    titleKey,
    descriptionKey,
    emptyKey,
    hintKey,
    homeId,
    max = 25,
    fields,
    list,
    keyOf,
    describe,
    summarise,
    toValues,
    create,
    update,
    remove,
  } = definition;

  const byId = new Map(fields.map((field) => [field.id, field]));

  const buttonId = (action, ref = "") => `${id}:${action}${ref ? `:${ref}` : ""}`;
  const selectId = (action, ref = "") => `${id}${SELECT_MARK}:${action}:${ref}`;
  const modalId = (action, ref = "") => `${id}${MODAL_MARK}:${action}:${ref}`;

  const matches = (customId) =>
    String(customId).startsWith(`${id}:`) ||
    String(customId).startsWith(`${id}${SELECT_MARK}:`) ||
    String(customId).startsWith(`${id}${MODAL_MARK}:`);

  /**
   * @param {string} customId
   * @returns {{kind: "button"|"select"|"modal", action: string, ref: string}|null}
   */
  function parse(customId) {
    const text = String(customId);
    const mark = text.startsWith(`${id}${SELECT_MARK}:`)
      ? SELECT_MARK
      : text.startsWith(`${id}${MODAL_MARK}:`)
        ? MODAL_MARK
        : text.startsWith(`${id}:`)
          ? ""
          : null;

    if (mark === null) return null;

    const kind = mark === SELECT_MARK ? "select" : mark === MODAL_MARK ? "modal" : "button";
    const [action, ...rest] = text.slice(id.length + mark.length + 1).split(":");
    return { kind, action, ref: rest.join(":") };
  }

  /** Where one entry's half-finished edits are kept. */
  const draftPath = (key) => `${id}|${key}`;

  /**
   * @param {import('discord.js').Interaction} interaction
   * @param {EmbedBuilder} embed
   * @param {object} settings
   */
  function brand(interaction, embed, settings) {
    applyBranding(embed, resolveBranding(settings, interaction.client), { force: true });
    return embed;
  }

  /**
   * @param {(key: string, vars?: object) => string} t
   * @param {ButtonBuilder[]} before
   * @param {string} backId
   */
  function navigation(t, before, backId) {
    const buttons = [...before];

    if (backId) {
      buttons.push(
        new ButtonBuilder()
          .setCustomId(backId)
          .setEmoji("↩️")
          .setLabel(t("common.back"))
          .setStyle(ButtonStyle.Secondary)
      );
    }

    if (homeId) {
      buttons.push(
        new ButtonBuilder()
          .setCustomId(homeId)
          .setEmoji("🏠")
          .setLabel(t("common.menu"))
          .setStyle(ButtonStyle.Secondary)
      );
    }

    return new ActionRowBuilder().addComponents(buttons);
  }

  /**
   * Screen one: everything the server has of this kind.
   *
   * @param {(key: string, vars?: object) => string} t
   * @param {object} settings guild settings document
   * @param {import('discord.js').Interaction} interaction
   */
  /**
   * One entry as a line, or a placeholder when the entry cannot be read.
   *
   * Settings outlive the code that wrote them, and a value from an older shape
   * should cost the line it belongs to rather than the panel.
   */
  function line(entry, t, guild) {
    try {
      return describe(entry, t, guild);
    } catch {
      return `⚠️ ${t("collections.broken")}`;
    }
  }

  async function buildList(t, settings, interaction) {
    const entries = await list(interaction.guild, settings);

    const embed = new EmbedBuilder()
      .setColor(EMBED_COLORS.BOT_EMBED)
      .setTitle(`${icon} ${t(titleKey)}`)
      .setDescription(
        [
          t(descriptionKey),
          "",
          entries.length ? entries.map((entry) => line(entry, t, interaction.guild)).join("\n\n") : t(emptyKey),
          "",
          `-# ${entries.length ? t("collections.count", { count: entries.length, max }) : t(hintKey)}`,
        ]
          .join("\n")
          .slice(0, 4000)
      );

    brand(interaction, embed, settings);

    // An entry the panel cannot identify has nothing to put in a menu row, and
    // Discord rejects the whole menu over one empty value — it stays listed above
    // as unreadable instead.
    const openable = entries.map((entry) => ({ entry, key: safely(() => keyOf(entry), "") })).filter((row) => row.key);

    const components = [];
    if (openable.length) {
      components.push(
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(selectId("open"))
            .setPlaceholder(t("collections.pick"))
            .addOptions(
              openable.slice(0, 25).map(({ entry, key }) => ({
                value: editor.fit(key, 100),
                label: editor.fit(
                  safely(() => summarise(entry, t, interaction.guild), key),
                  100
                ),
              }))
            )
        )
      );
    }

    const add = new ButtonBuilder()
      .setCustomId(buttonId("new"))
      .setEmoji("➕")
      .setLabel(t("collections.add"))
      .setStyle(ButtonStyle.Success)
      .setDisabled(entries.length >= max);

    components.push(navigation(t, [add], null));

    return { embeds: [embed], components };
  }

  /**
   * Screens two and three: one entry, existing or not yet.
   *
   * @param {(key: string, vars?: object) => string} t
   * @param {object} settings
   * @param {import('discord.js').Interaction} interaction
   * @param {string} key entry key, or "+" for one being created
   * @param {{focus?: string, note?: string}} [view]
   */
  function buildEntry(t, settings, interaction, key, { focus = null, note = null } = {}) {
    const values = draft.read(interaction.user.id, draftPath(key));
    const gaps = editor.missing(fields, values);
    const creating = key === NEW;

    const embed = new EmbedBuilder()
      .setColor(EMBED_COLORS.BOT_EMBED)
      .setTitle(`${icon} ${t(titleKey)} · ${t(creating ? "collections.newEntry" : "collections.entry")}`)
      .setDescription(
        [
          note || t(descriptionKey),
          "",
          ...editor.lines(t, fields, values, { focus }),
          "",
          `-# ${gaps.length ? t("collections.missing", { names: gaps.map((field) => editor.label(field, t)).join(", ") }) : t("collections.ready")}`,
        ]
          .join("\n")
          .slice(0, 4000)
      );

    brand(interaction, embed, settings);

    const rows = editor.rows(t, fields, values, (field) => buttonId("field", `${key}|${field.id}`), { rows: 3 });

    const save = new ButtonBuilder()
      .setCustomId(buttonId("save", key))
      .setEmoji(creating ? "✅" : "💾")
      .setLabel(t(creating ? "collections.create" : "collections.save"))
      .setStyle(ButtonStyle.Success)
      .setDisabled(gaps.length > 0);

    const actions = [save];
    if (!creating) {
      actions.push(
        new ButtonBuilder()
          .setCustomId(buttonId("del", key))
          .setEmoji("🗑️")
          .setLabel(t("collections.remove"))
          .setStyle(ButtonStyle.Danger)
      );
    }

    rows.push(navigation(t, actions, buttonId("list")));

    return { embeds: [embed], components: rows };
  }

  /**
   * The entry screen with one picker open in place of the field buttons.
   */
  function buildPicker(t, settings, interaction, key, field) {
    const values = draft.read(interaction.user.id, draftPath(key));
    const base = buildEntry(t, settings, interaction, key, { focus: field.id });

    const menu = editor.select(field, values[field.id] ?? null, {
      customId: selectId("field", `${key}|${field.id}`),
      placeholder: editor.label(field, t),
      guild: interaction.guild,
    });

    return {
      embeds: base.embeds,
      components: [new ActionRowBuilder().addComponents(menu), navigation(t, [], buttonId("open", key))],
    };
  }

  /**
   * Load an entry's stored values into the draft it is edited through, so the
   * screen always opens on what is actually saved.
   */
  async function adopt(interaction, settings, key) {
    const entries = await list(interaction.guild, settings);
    const entry = entries.find((candidate) => keyOf(candidate) === key);
    if (!entry) return false;

    draft.clear(interaction.user.id, draftPath(key));
    for (const [field, value] of Object.entries(toValues(entry, interaction.guild))) {
      draft.write(interaction.user.id, draftPath(key), field, value);
    }

    return true;
  }

  /**
   * @param {import('discord.js').Interaction} interaction
   * @param {object} settings guild settings document
   * @param {(key: string, vars?: object) => string} t
   * @returns {Promise<boolean>} whether the interaction belonged here
   */
  async function handle(interaction, settings, t) {
    const parsed = parse(interaction.customId);
    if (!parsed) return false;

    const context = { guild: interaction.guild, settings, user: interaction.user, client: interaction.client, t };
    const showList = () => slowRedraw(interaction, () => buildList(t, settings, interaction));

    if (parsed.action === "list") {
      await showList();
      return true;
    }

    if (parsed.action === "new") {
      draft.clear(interaction.user.id, draftPath(NEW));
      for (const field of fields) {
        if (field.default !== undefined) draft.write(interaction.user.id, draftPath(NEW), field.id, field.default);
      }
      await redraw(interaction, buildEntry(t, settings, interaction, NEW));
      return true;
    }

    if (parsed.action === "open" || (parsed.kind === "select" && parsed.action === "open")) {
      const key = parsed.kind === "select" ? interaction.values[0] : parsed.ref;
      // Reading the entry back is a database round-trip of its own.
      await ack(interaction);

      if (!(await adopt(interaction, settings, key))) {
        await showList();
        return true;
      }

      await redraw(interaction, buildEntry(t, settings, interaction, key));
      return true;
    }

    if (parsed.action === "field") {
      const [key, fieldId] = parsed.ref.split("|");
      const field = byId.get(fieldId);
      if (!field) {
        await showList();
        return true;
      }

      const values = draft.read(interaction.user.id, draftPath(key));

      if (parsed.kind === "modal") {
        const parsedValue = editor.parseInput(field, interaction.fields.getTextInputValue("value"));
        if (!parsedValue.ok) {
          await warn(interaction, t(parsedValue.reason, { min: field.min ?? 0, max: field.max ?? 99 }));
          return true;
        }

        draft.write(interaction.user.id, draftPath(key), fieldId, parsedValue.value);
        await redraw(interaction, buildEntry(t, settings, interaction, key));
        return true;
      }

      if (parsed.kind === "select") {
        draft.write(interaction.user.id, draftPath(key), fieldId, interaction.values[0] ?? null);
        await redraw(interaction, buildEntry(t, settings, interaction, key));
        return true;
      }

      if (field.type === "toggle") {
        draft.write(interaction.user.id, draftPath(key), fieldId, !values[fieldId]);
        await redraw(interaction, buildEntry(t, settings, interaction, key));
        return true;
      }

      if (field.type === "text" || field.type === "number") {
        await interaction.showModal(
          editor.modal(field, values[fieldId] ?? null, { customId: modalId("field", `${key}|${fieldId}`), t })
        );
        return true;
      }

      await redraw(interaction, buildPicker(t, settings, interaction, key, field));
      return true;
    }

    if (parsed.action === "save") {
      const key = parsed.ref;
      const values = draft.read(interaction.user.id, draftPath(key));
      const gaps = editor.missing(fields, values);

      if (gaps.length) {
        await warn(
          interaction,
          t("collections.missing", { names: gaps.map((field) => editor.label(field, t)).join(", ") })
        );
        return true;
      }

      // Saving talks to Discord and to the source being watched, which is slower
      // than the three seconds a click may take.
      await ack(interaction);
      const result =
        key === NEW ? await create({ ...context, values }) : await update({ ...context, key, values, previous: key });

      if (result.ok) draft.clear(interaction.user.id, draftPath(key === NEW ? NEW : key));

      await redraw(interaction, await buildList(t, settings, interaction));
      await interaction.followUp({ content: result.message, ephemeral: true });
      return true;
    }

    if (parsed.action === "del") {
      await ack(interaction);
      const result = await remove({ ...context, key: parsed.ref });

      draft.clear(interaction.user.id, draftPath(parsed.ref));
      await redraw(interaction, await buildList(t, settings, interaction));
      await interaction.followUp({ content: result.message, ephemeral: true });
      return true;
    }

    return true;
  }

  return {
    NEW,
    buildEntry,
    buildList,
    buildPicker,
    fields,
    handle,
    icon,
    id,
    matches,
    parse,
    /** The hub opens every panel the same way, whatever shape it has inside. */
    open: (t, settings, interaction) => buildList(t, settings, interaction),
  };
}

module.exports = { NEW, defineCollectionPanel };
