const test = require("node:test");
const assert = require("node:assert/strict");
require("module-alias/register");

const { ChannelType } = require("discord.js");
const {
  ensureChannelOverwrite,
  ensureGuildOverwrites,
  isTextChannel,
  isVoiceChannel,
} = require("@src/services/moderation/muteRole");

const ROLE_ID = "100000000000000001";
const EXCLUDED_ID = "200000000000000002";

function settingsWith(moderation) {
  return { control_center: { moderation } };
}

function fakeChannel({ id, type, permissionOverwrites = null }) {
  const overwrites = permissionOverwrites || {
    cache: new Map(),
    edits: [],
    async edit(role, patch) {
      this.edits.push({ roleId: role.id, patch });
      this.cache.set(role.id, {
        deny: { has: (flag) => Object.entries(patch).some(([key, value]) => key === flag && value === false) },
      });
    },
  };
  return {
    id,
    type,
    permissionOverwrites: overwrites,
    isThread: () => false,
    isTextBased: () => type === ChannelType.GuildText,
  };
}

const ROLE = { id: ROLE_ID };

/* -------------------------------------------------------------- channel kind */

test("isTextChannel and isVoiceChannel classify by Discord's own channel type", () => {
  const text = fakeChannel({ id: "t", type: ChannelType.GuildText });
  const voice = fakeChannel({ id: "v", type: ChannelType.GuildVoice });
  const stage = fakeChannel({ id: "s", type: ChannelType.GuildStageVoice });

  assert.equal(isTextChannel(text), true);
  assert.equal(isVoiceChannel(text), false);
  assert.equal(isTextChannel(voice), false);
  assert.equal(isVoiceChannel(voice), true);
  assert.equal(isVoiceChannel(stage), true);
});

/* ---------------------------------------------------------- ensureChannelOverwrite */

test("a text channel gets the text-deny overwrite when the scope covers text", async () => {
  const channel = fakeChannel({ id: "t", type: ChannelType.GuildText });
  await ensureChannelOverwrite(channel, ROLE, settingsWith({ default_mute_scope: "ALL" }));

  assert.equal(channel.permissionOverwrites.edits.length, 1);
  assert.deepEqual(channel.permissionOverwrites.edits[0].patch, {
    SendMessages: false,
    SendMessagesInThreads: false,
    AddReactions: false,
  });
});

test("a voice channel gets the voice-deny overwrite instead", async () => {
  const channel = fakeChannel({ id: "v", type: ChannelType.GuildVoice });
  await ensureChannelOverwrite(channel, ROLE, settingsWith({ default_mute_scope: "ALL" }));

  assert.deepEqual(channel.permissionOverwrites.edits[0].patch, { Connect: false, Speak: false });
});

test("a scope of TEXT never touches a voice channel, and VOICE never touches a text one", async () => {
  const textChannel = fakeChannel({ id: "t", type: ChannelType.GuildText });
  const voiceChannel = fakeChannel({ id: "v", type: ChannelType.GuildVoice });

  await ensureChannelOverwrite(voiceChannel, ROLE, settingsWith({ default_mute_scope: "TEXT" }));
  assert.equal(voiceChannel.permissionOverwrites.edits.length, 0);

  await ensureChannelOverwrite(textChannel, ROLE, settingsWith({ default_mute_scope: "VOICE" }));
  assert.equal(textChannel.permissionOverwrites.edits.length, 0);
});

test("an excluded channel is never touched, regardless of scope", async () => {
  const channel = fakeChannel({ id: EXCLUDED_ID, type: ChannelType.GuildText });
  await ensureChannelOverwrite(
    channel,
    ROLE,
    settingsWith({ default_mute_scope: "ALL", mute_excluded_channels: [EXCLUDED_ID] })
  );
  assert.equal(channel.permissionOverwrites.edits.length, 0);
});

test("an already-correct overwrite is not re-applied", async () => {
  const channel = fakeChannel({ id: "t", type: ChannelType.GuildText });
  const settings = settingsWith({ default_mute_scope: "ALL" });

  await ensureChannelOverwrite(channel, ROLE, settings);
  await ensureChannelOverwrite(channel, ROLE, settings);

  assert.equal(channel.permissionOverwrites.edits.length, 1, "the second call found it already denied");
});

test("a channel without permissionOverwrites (e.g. a category) is skipped, not thrown at", async () => {
  const channel = { id: "c", type: ChannelType.GuildCategory, isThread: () => false, isTextBased: () => false };
  await assert.doesNotReject(ensureChannelOverwrite(channel, ROLE, settingsWith({ default_mute_scope: "ALL" })));
});

/* ----------------------------------------------------------- ensureGuildOverwrites */

test("ensureGuildOverwrites walks every channel in the guild", async () => {
  const text = fakeChannel({ id: "t", type: ChannelType.GuildText });
  const voice = fakeChannel({ id: "v", type: ChannelType.GuildVoice });
  const guild = {
    channels: {
      cache: new Map([
        ["t", text],
        ["v", voice],
      ]),
    },
  };

  await ensureGuildOverwrites(guild, ROLE, settingsWith({ default_mute_scope: "ALL" }));

  assert.equal(text.permissionOverwrites.edits.length, 1);
  assert.equal(voice.permissionOverwrites.edits.length, 1);
});

test("ensureGuildOverwrites does nothing without a role", async () => {
  const guild = { channels: { cache: new Map() } };
  await assert.doesNotReject(ensureGuildOverwrites(guild, null, settingsWith({})));
});
