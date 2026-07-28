const test = require("node:test");
const assert = require("node:assert/strict");
require("module-alias/register");
require("../src/helpers/ConfigDefaults").applyConfigDefaults();

const {
  buildCategoryNotificationPayload,
  getNotificationRoleIds,
  sendCategoryTicketNotification,
} = require("../src/helpers/TicketNotifications");

function createFixture() {
  const sentPayloads = [];
  const notificationChannel = {
    canSendEmbeds: () => true,
    safeSend: async (payload) => {
      sentPayloads.push(payload);
      return { id: "notification-message" };
    },
  };
  const guild = {
    id: "guild-id",
    roles: {
      cache: new Map([
        ["global-support", { id: "global-support" }],
        ["category-support", { id: "category-support" }],
      ]),
    },
    channels: {
      cache: new Map([["notifications", notificationChannel]]),
    },
  };
  const category = {
    name: "Billing",
    staff_roles: ["category-support", "missing-role"],
    notification_channel: "notifications",
  };
  const settings = {
    ticket: {
      staff_roles: ["global-support", "category-support", "guild-id"],
    },
  };
  const user = {
    id: "user-id",
    toString: () => "<@user-id>",
  };
  const ticketMessage = {
    url: "https://discord.com/channels/guild-id/ticket-id/message-id",
    channel: {
      toString: () => "<#ticket-id>",
    },
  };

  return { category, guild, notificationChannel, sentPayloads, settings, ticketMessage, user };
}

test("notification roles combine valid global and category support roles", () => {
  const { category, guild, settings } = createFixture();
  assert.deepEqual(getNotificationRoleIds(settings, category, guild), ["global-support", "category-support"]);
});

test("notification payload links the ticket and limits role mentions", () => {
  const { category, guild, ticketMessage, user } = createFixture();
  const payload = buildCategoryNotificationPayload({
    guild,
    user,
    category,
    ticketMessage,
    roleIds: ["global-support", "category-support"],
  });

  assert.equal(payload.content, "<@&global-support> <@&category-support>");
  assert.deepEqual(payload.allowedMentions, { roles: ["global-support", "category-support"] });
  assert.equal(payload.components[0].components[0].data.url, ticketMessage.url);
  assert.match(payload.embeds[0].data.fields[0].value, /Billing/);
});

test("sends notification to the channel configured for the selected category", async () => {
  const fixture = createFixture();
  assert.equal(await sendCategoryTicketNotification(fixture), true);
  assert.equal(fixture.sentPayloads.length, 1);
  assert.deepEqual(fixture.sentPayloads[0].allowedMentions.roles, ["global-support", "category-support"]);
});

test("skips notification when a category has no usable notification channel", async () => {
  const fixture = createFixture();
  fixture.category.notification_channel = undefined;
  assert.equal(await sendCategoryTicketNotification(fixture), false);

  fixture.category.notification_channel = "deleted-channel";
  assert.equal(await sendCategoryTicketNotification(fixture), false);
  assert.equal(fixture.sentPayloads.length, 0);
});
