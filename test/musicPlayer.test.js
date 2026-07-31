require("module-alias/register");

const test = require("node:test");
const assert = require("node:assert/strict");
const { connectMusicPlayer, setBassBoost, skipCurrentTrack } = require("../src/helpers/MusicPlayer");
const { handleMusicIdleState, musicIdleTimers } = require("../src/events/voice/voiceStateUpdate");

test("bass boost uses the Lavalink v4 equalizer filter", async () => {
  let received;
  const player = {
    async setFilters(name, value) {
      received = { name, value };
    },
  };

  await setBassBoost(player, 0.25);

  assert.equal(received.name, "equalizer");
  assert.equal(received.value.length, 15);
  assert.deepEqual(received.value.slice(0, 4), [
    { band: 0, gain: 0.25 },
    { band: 1, gain: 0.25 },
    { band: 2, gain: 0.25 },
    { band: 3, gain: 0 },
  ]);
});

test("skip advances to the next queued track and awaits playback", async () => {
  let resolveNext;
  const nextFinished = new Promise((resolve) => {
    resolveNext = resolve;
  });
  const current = { title: "Current" };
  const player = {
    queue: {
      current,
      tracks: [{ title: "Next" }],
      async next() {
        await nextFinished;
        this.current = this.tracks.shift();
        return true;
      },
    },
  };

  let settled = false;
  const pending = skipCurrentTrack(player).then((result) => {
    settled = true;
    return result;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);

  resolveNext();
  const result = await pending;
  assert.equal(result.track, current);
  assert.equal(player.queue.current.title, "Next");
});

test("skip stops the last track and finishes the queue", async () => {
  const events = [];
  const current = { title: "Last" };
  const player = {
    stopped: false,
    async stop() {
      this.stopped = true;
    },
    queue: {
      current,
      tracks: [],
      last: null,
      emit(event) {
        events.push(event);
      },
    },
  };

  const result = await skipCurrentTrack(player);

  assert.equal(result.finished, true);
  assert.equal(player.stopped, true);
  assert.equal(player.queue.current, null);
  assert.equal(player.queue.last, current);
  assert.deepEqual(events, ["finish"]);
});

test("voice connection retries on the next active Lavalink node", async () => {
  const destroyed = [];
  let created = 0;
  const manager = {
    nodes: new Map([
      ["one", {}],
      ["two", {}],
    ]),
    getPlayer() {
      return null;
    },
    createPlayer(_guildId, { excludedNodeIdentifiers }) {
      created += 1;
      const identifier = created === 1 ? "one" : "two";
      assert.equal(excludedNodeIdentifiers.has(identifier), false);
      return {
        node: { identifier },
        voice: { channelId: null, connected: false },
        queue: { data: {} },
        async connect(channelId) {
          if (identifier === "one") throw new Error("first node failed");
          this.voice.channelId = channelId;
          this.voice.connected = true;
        },
        disconnect() {},
      };
    },
    async destroyPlayer(guildId) {
      destroyed.push(guildId);
    },
  };

  const player = await connectMusicPlayer({
    manager,
    guildId: "guild",
    voiceChannel: { id: "voice" },
    textChannel: { id: "text" },
    timeoutMs: 20,
  });

  assert.equal(player.node.identifier, "two");
  assert.equal(player.queue.data.channel.id, "text");
  assert.deepEqual(destroyed, ["guild"]);
});

test("idle music player is destroyed after the configured timeout", async () => {
  const voiceChannel = { id: "voice", members: new Map([["bot", {}]]) };
  const guild = {
    id: "guild-idle",
    members: { me: { voice: { channel: voiceChannel } } },
  };
  let disconnected = false;
  let destroyed = false;
  const client = {
    config: { MUSIC: { IDLE_TIME: 0.001 } },
    musicManager: {
      getPlayer: () => ({
        disconnect() {
          disconnected = true;
        },
      }),
      async destroyPlayer() {
        destroyed = true;
      },
    },
    logger: { error() {} },
  };

  handleMusicIdleState(client, { guild, channelId: "voice" }, { guild, channelId: null });
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.equal(disconnected, true);
  assert.equal(destroyed, true);
  assert.equal(musicIdleTimers.has(guild.id), false);
});

test("a returning listener cancels pending idle destruction", async () => {
  const voiceChannel = { id: "voice", members: new Map([["bot", {}]]) };
  const guild = {
    id: "guild-return",
    members: { me: { voice: { channel: voiceChannel } } },
  };
  let destroyed = false;
  const client = {
    config: { MUSIC: { IDLE_TIME: 0.02 } },
    musicManager: {
      getPlayer: () => ({ disconnect() {} }),
      async destroyPlayer() {
        destroyed = true;
      },
    },
    logger: { error() {} },
  };

  handleMusicIdleState(client, { guild, channelId: "voice" }, { guild, channelId: null });
  voiceChannel.members.set("listener", {});
  handleMusicIdleState(client, { guild, channelId: null }, { guild, channelId: "voice" });
  await new Promise((resolve) => setTimeout(resolve, 30));

  assert.equal(destroyed, false);
  assert.equal(musicIdleTimers.has(guild.id), false);
});
