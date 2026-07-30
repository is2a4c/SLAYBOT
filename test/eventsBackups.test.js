const test = require("node:test");
const assert = require("node:assert/strict");
require("module-alias/register");

const { ChannelType, PermissionFlagsBits } = require("discord.js");
const { EventError, resolveWindow } = require("../src/services/events/ScheduledEvents");
const { planRestore, snapshotGuild } = require("../src/services/backups/GuildBackups");

/* --------------------------------------------------------- scheduled events */

test("the event window is derived from the start delay and duration", () => {
  const now = Date.parse("2026-07-30T12:00:00.000Z");

  const withDuration = resolveWindow({ startInMs: 2 * 60 * 60 * 1000, durationMs: 90 * 60 * 1000, now });
  assert.equal(withDuration.startsAt.toISOString(), "2026-07-30T14:00:00.000Z");
  assert.equal(withDuration.endsAt.toISOString(), "2026-07-30T15:30:00.000Z");

  const openEnded = resolveWindow({ startInMs: 60 * 60 * 1000, now });
  assert.equal(openEnded.endsAt, null);
});

test("impossible event windows are rejected", () => {
  assert.throws(() => resolveWindow({ startInMs: null }), EventError);
  assert.throws(() => resolveWindow({ startInMs: 1000 }), /at least a minute from now/);
  assert.throws(() => resolveWindow({ startInMs: 40 * 24 * 60 * 60 * 1000 }), /more than 30 days/);
  assert.throws(() => resolveWindow({ startInMs: 60_000, durationMs: 1000 }), /last at least a minute/);
  assert.throws(
    () => resolveWindow({ startInMs: 60_000, durationMs: 40 * 24 * 60 * 60 * 1000 }),
    /longer than 30 days/
  );
});

/* ------------------------------------------------------------------ backups */

function fakeGuild() {
  const guildId = "999999999999999999";

  const role = (id, name, position, extra = {}) => ({
    id,
    name,
    position,
    managed: false,
    hoist: false,
    mentionable: false,
    hexColor: "#ffffff",
    permissions: { bitfield: 8n },
    ...extra,
  });

  const roles = new Map([
    [guildId, role(guildId, "@everyone", 0)],
    ["1", role("1", "Admin", 5)],
    ["2", role("2", "Bot Role", 4, { managed: true })],
    ["3", role("3", "Member", 1)],
  ]);

  const channel = (id, name, type, extra = {}) => ({
    id,
    name,
    type,
    rawPosition: Number(id),
    guild: { id: guildId, roles: { cache: roles } },
    permissionOverwrites: { cache: new Map() },
    ...extra,
  });

  const general = channel("1", "general", ChannelType.GuildText, {
    topic: "chat",
    nsfw: false,
    rateLimitPerUser: 5,
    parent: { name: "Text" },
  });
  general.permissionOverwrites.cache.set("3", {
    id: "3",
    type: 0,
    allow: { bitfield: PermissionFlagsBits.SendMessages },
    deny: { bitfield: 0n },
  });

  const channels = new Map([
    ["0", channel("0", "Text", ChannelType.GuildCategory)],
    ["1", general],
    ["2", channel("2", "Voice chat", ChannelType.GuildVoice, { bitrate: 64000, userLimit: 10, parent: null })],
    ["3", channel("3", "thread-ish", ChannelType.PublicThread)],
  ]);

  return {
    id: guildId,
    name: "Slay",
    verificationLevel: 1,
    explicitContentFilter: 2,
    defaultMessageNotifications: 1,
    afkTimeout: 300,
    systemChannel: { name: "general" },
    iconURL: () => "https://cdn/icon.png",
    roles: { cache: roles },
    channels: { cache: channels },
    emojis: { cache: new Map([["1", { name: "vip", animated: false, imageURL: () => "https://cdn/vip.png" }]]) },
  };
}

test("a snapshot keeps structure and drops managed roles, @everyone and threads", () => {
  const snapshot = snapshotGuild(fakeGuild());

  assert.deepEqual(
    snapshot.roles.map((role) => role.name),
    ["Admin", "Member"],
    "highest first, no @everyone, no integration roles"
  );

  assert.deepEqual(
    snapshot.channels.map((channel) => channel.name),
    ["Text", "general", "Voice chat"],
    "threads are not part of the structure"
  );

  const general = snapshot.channels.find((channel) => channel.name === "general");
  assert.equal(general.parent, "Text");
  assert.equal(general.topic, "chat");
  assert.equal(general.rateLimitPerUser, 5);
  assert.deepEqual(general.overwrites, [
    { role: "Member", allow: String(PermissionFlagsBits.SendMessages), deny: "0" },
  ]);

  assert.equal(snapshot.guild.name, "Slay");
  assert.equal(snapshot.emojis[0].url, "https://cdn/vip.png");
});

test("a restore plan only adds what is missing and never touches what exists", () => {
  const snapshot = snapshotGuild(fakeGuild());

  const plan = planRestore({
    snapshot,
    existingRoles: ["@everyone", "admin"],
    existingChannels: ["general"],
  });

  assert.deepEqual(
    plan.roles.map((role) => role.name),
    ["Member"],
    "role matching is case-insensitive"
  );
  assert.deepEqual(
    plan.categories.map((category) => category.name),
    ["Text"]
  );
  assert.deepEqual(
    plan.channels.map((channel) => channel.name),
    ["Voice chat"]
  );
});

test("a restore into the same server plans nothing", () => {
  const guild = fakeGuild();
  const snapshot = snapshotGuild(guild);

  const plan = planRestore({
    snapshot,
    existingRoles: [...guild.roles.cache.values()].map((role) => role.name),
    existingChannels: [...guild.channels.cache.values()].map((channel) => channel.name),
  });

  assert.deepEqual(plan, { roles: [], categories: [], channels: [] });
});
