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

test("boost templates render member, server, and boost count with safe mentions", async () => {
  const target = member();
  const payload = await boostPayload(target, { boost_message: "{member:name} boosted {server} to {boosts}" });
  assert.equal(payload.embeds[0].toJSON().description, "Booster boosted Server to 7");
  assert.deepEqual(payload.allowedMentions, { users: [target.id], parse: [] });
});

test("a blank boost message falls back to a default line, and the footer to the boost count", async () => {
  const target = member();
  const payload = await boostPayload(target, {});
  const embed = payload.embeds[0].toJSON();
  assert.equal(embed.description, "**Booster** boosted the server!");
  assert.equal(embed.footer.text, "7 boosts");
  assert.equal(embed.color, 0xf47fff);
});

test("title, author, footer, colour, and a custom fields/buttons set are all rendered", async () => {
  const target = member();
  const payload = await boostPayload(target, {
    boost_title: "Thanks for the boost!",
    boost_author: "{server} boosts",
    boost_footer: "Custom footer",
    boost_color: "#123456",
    boost_fields: [{ name: "Perk", value: "Custom role", inline: true }],
    boost_buttons: [{ label: "Perks", url: "https://example.com/perks" }],
  });
  const embed = payload.embeds[0].toJSON();
  assert.equal(embed.title, "Thanks for the boost!");
  assert.equal(embed.author.name, "Server boosts");
  assert.equal(embed.footer.text, "Custom footer");
  assert.equal(embed.color, 0x123456);
  assert.deepEqual(embed.fields, [{ name: "Perk", value: "Custom role", inline: true }]);
  assert.equal(payload.components.length, 1);
});

test("the booster's avatar thumbnail can be turned off", async () => {
  const target = member();
  target.displayAvatarURL = () => "https://example.com/avatar.png";
  const withThumbnail = await boostPayload(target, {});
  assert.equal(withThumbnail.embeds[0].toJSON().thumbnail.url, "https://example.com/avatar.png");

  const withoutThumbnail = await boostPayload(target, { boost_thumbnail: false });
  assert.equal(withoutThumbnail.embeds[0].toJSON().thumbnail, undefined);
});

test("the timestamp can be turned off", async () => {
  const target = member();
  const withTimestamp = await boostPayload(target, {});
  assert.ok(withTimestamp.embeds[0].toJSON().timestamp);

  const withoutTimestamp = await boostPayload(target, { boost_timestamp: false });
  assert.equal(withoutTimestamp.embeds[0].toJSON().timestamp, undefined);
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
