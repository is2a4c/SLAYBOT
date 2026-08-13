const test = require("node:test");
const assert = require("node:assert/strict");
require("module-alias/register");

const {
  buildModerationDm,
  buildWarningDm,
  sendModerationDm,
  sendWarningDm,
} = require("@src/services/moderationNotifications");

function details(overrides = {}) {
  return {
    guild: { id: "100000000000000001", name: "Тестовый сервер", iconURL: () => null },
    issuer: { id: "100000000000000002", displayName: "Модератор" },
    reason: "Нарушение правил",
    warnings: 2,
    maxWarnings: 3,
    automaticAction: null,
    ...overrides,
  };
}

test("warning DM includes the server, moderator, reason and warning count", () => {
  const payload = buildWarningDm(details());
  const json = payload.embeds[0].toJSON();

  assert.match(json.description, /Тестовый сервер/);
  assert.deepEqual(
    json.fields.map(({ name, value }) => [name, value]),
    [
      ["Причина", "Нарушение правил"],
      ["Модератор", "Модератор (100000000000000002)"],
      ["Предупреждения", "2/3"],
    ]
  );
});

test("warning DM names the automatic punishment at the warning limit", () => {
  const payload = buildWarningDm(details({ warnings: 3, automaticAction: "BAN" }));
  const automaticAction = payload.embeds[0].toJSON().fields.at(-1);

  assert.deepEqual(automaticAction, { name: "Автоматическое наказание", value: "бан" });
});

test("warning DM respects the guild setting", async () => {
  let sends = 0;
  const target = {
    guild: details().guild,
    send: async () => {
      sends += 1;
    },
  };

  const delivered = await sendWarningDm({
    target,
    settings: { control_center: { notifications: { dm_on_warn: false } } },
    ...details(),
  });

  assert.equal(delivered, false);
  assert.equal(sends, 0);
});

test("closed DMs do not fail the moderation action", async () => {
  const target = {
    id: "100000000000000003",
    guild: details().guild,
    client: { logger: { debug: () => {} } },
    send: async () => {
      throw new Error("Cannot send messages to this user");
    },
  };

  const delivered = await sendWarningDm({ target, settings: {}, ...details() });
  assert.equal(delivered, false);
});

test("kick, ban, and timeout notifications respect their independent switches", async () => {
  const sent = [];
  const guild = { ...details().guild, client: { logger: { debug: () => {} } } };
  const target = { id: "100000000000000003", username: "Member", send: async (payload) => sent.push(payload) };
  const payload = buildModerationDm({ ...details(), guild, target, action: "KICK" });
  assert.match(payload.embeds[0].toJSON().description, /кик/);

  assert.equal(
    await sendModerationDm({
      ...details(),
      guild,
      target,
      action: "KICK",
      settings: { control_center: { notifications: { dm_on_kick: false } } },
    }),
    false
  );
  assert.equal(sent.length, 0);
  assert.equal(await sendModerationDm({ ...details(), guild, target, action: "BAN", settings: {} }), true);
  assert.equal(sent.length, 1);
});
