const test = require("node:test");
const assert = require("node:assert/strict");
require("module-alias/register");

const { boostPayload, sendBoostNotification } = require("../src/services/memberNotifications");

function member() {
  const sent = [];
  const channel = {
    id: "100000000000000002",
    isTextBased: () => true,
    send: async (payload) => (sent.push(payload), payload),
  };
  return {
    id: "100000000000000001",
    displayName: "Booster",
    displayAvatarURL: () => null,
    guild: {
      id: "100000000000000000",
      name: "Server",
      premiumSubscriptionCount: 7,
      channels: { cache: new Map([[channel.id, channel]]) },
    },
    sent,
    channel,
  };
}

test("boost templates render member, server, and boost count with safe mentions", () => {
  const target = member();
  const payload = boostPayload(target, { boost_message: "{member:name} boosted {server} to {boosts}" });
  assert.equal(payload.embeds[0].toJSON().description, "Booster boosted Server to 7");
  assert.deepEqual(payload.allowedMentions, { users: [target.id], parse: [] });
});

test("boost notification needs an enabled setting and a real text channel", async () => {
  const target = member();
  assert.equal(await sendBoostNotification(target, { control_center: { notifications: {} } }), false);
  assert.equal(
    await sendBoostNotification(target, {
      control_center: {
        notifications: { boost_enabled: true, boost_channel: target.channel.id, boost_message: "Thanks!" },
      },
    }),
    true
  );
  assert.equal(target.sent.length, 1);
});
