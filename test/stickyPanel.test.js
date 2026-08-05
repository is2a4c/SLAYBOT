const test = require("node:test");
const assert = require("node:assert/strict");
require("module-alias/register");

const { translate } = require("@src/i18n");
const draft = require("@src/services/panels/draft");

/**
 * The sticky panel over a stand-in store.
 *
 * The panel talks to the database and to the sticky handler, and neither is worth
 * standing up to find out what a button does — so both are put into the module
 * cache before the panel is loaded, and the panel is driven exactly as a click
 * would drive it.
 */

const t = (key, vars) => translate("ru", key, vars);
const USER = "100000000000000001";
const OLD = "200000000000000002";
const NEW = "200000000000000003";

const stickies = new Map();
const posted = [];
const forgotten = [];

function stub(request, exports) {
  const path = require.resolve(request);
  require.cache[path] = { id: path, filename: path, loaded: true, exports };
}

stub("@schemas/StickyMessage", {
  getSticky: async (guildId, channelId) => stickies.get(channelId) || null,
  listStickies: async () => [...stickies.values()],
  deleteSticky: async (guildId, channelId) => stickies.delete(channelId),
  saveSticky: async (document) => {
    const stored = { ...stickies.get(document.channel_id), ...document };
    stickies.set(document.channel_id, stored);
    return stored;
  },
});

stub("@src/handlers", {
  stickyHandler: {
    postNow: async (channel, sticky) => posted.push({ channel: channel.id, content: sticky.content }),
    forget: (channelId) => forgotten.push(channelId),
  },
});

const panel = require("@src/services/panels/collections/sticky");

/**
 * @param {{customId: string, values?: string[], text?: string}} input
 */
function makeInteraction({ customId, values, text }) {
  const seen = { drawn: [], reply: [], followUp: [], defer: 0 };
  const channel = (id) => ({
    id,
    isTextBased: () => true,
    toString: () => `<#${id}>`,
    permissionsFor: () => ({ has: () => true }),
    messages: { fetch: async () => ({ delete: async () => {} }) },
  });

  const interaction = {
    customId,
    values,
    seen,
    deferred: false,
    replied: false,
    user: { id: USER },
    client: { user: { username: "SLAYBOT" } },
    guild: {
      id: "900000000000000009",
      preferredLocale: "ru",
      members: { me: { id: "5" } },
      channels: {
        cache: new Map([
          [OLD, channel(OLD)],
          [NEW, channel(NEW)],
        ]),
      },
      roles: { cache: new Map() },
      client: { logger: { error: () => {} } },
    },
    fields: { getTextInputValue: () => text },
    update: async (payload) => {
      interaction.replied = true;
      seen.drawn.push(payload);
    },
    editReply: async (payload) => seen.drawn.push(payload),
    deferUpdate: async () => {
      interaction.deferred = true;
      seen.defer += 1;
    },
    reply: async (payload) => {
      interaction.replied = true;
      seen.reply.push(payload);
    },
    followUp: async (payload) => seen.followUp.push(payload),
    showModal: async () => {},
  };

  return interaction;
}

test.beforeEach(() => {
  draft.reset();
  stickies.clear();
  posted.length = 0;
  forgotten.length = 0;
});

test("a sticky pointed at another channel leaves the first one behind clean", async () => {
  stickies.set(OLD, {
    guild_id: "900000000000000009",
    channel_id: OLD,
    content: "Правила",
    embed: true,
    enabled: true,
    min_messages: 3,
    cooldown_seconds: 5,
    last_message_id: "300000000000000004",
    created_by: USER,
  });

  await panel.handle(makeInteraction({ customId: `CFG_STICKY:open:${OLD}` }), {}, t);
  await panel.handle(makeInteraction({ customId: `CFG_STICKY~SEL:field:${OLD}|channel`, values: [NEW] }), {}, t);

  const save = makeInteraction({ customId: `CFG_STICKY:save:${OLD}` });
  await panel.handle(save, {}, t);

  assert.equal(stickies.has(OLD), false, "the channel it left keeps no sticky");
  assert.equal(stickies.get(NEW)?.content, "Правила", "and the one it moved to has it");
  assert.deepEqual(forgotten, [OLD]);
  assert.deepEqual(
    posted.map((entry) => entry.channel),
    [NEW]
  );
  assert.match(save.seen.followUp[0].content, new RegExp(NEW), "the panel says where it went");
});

test("removing a sticky takes its posted copy with it", async () => {
  stickies.set(OLD, {
    guild_id: "900000000000000009",
    channel_id: OLD,
    content: "Правила",
    enabled: true,
    last_message_id: "300000000000000004",
  });

  const removal = makeInteraction({ customId: `CFG_STICKY:del:${OLD}` });
  await panel.handle(removal, {}, t);

  assert.equal(stickies.has(OLD), false);
  assert.deepEqual(forgotten, [OLD]);
  assert.equal(removal.seen.followUp[0].content, t("panels.sticky.removed"));
});
