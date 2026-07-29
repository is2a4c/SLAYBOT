const test = require("node:test");
const assert = require("node:assert/strict");
const { waitForVoiceConnection } = require("../src/helpers/VoiceConnection");

test("resolves immediately for an established connection", async () => {
  const player = {
    voice: {
      channelId: "voice-1",
      connected: true,
    },
  };

  await waitForVoiceConnection(player, "voice-1", { timeoutMs: 20, pollMs: 1 });
});

test("waits until both the Discord channel and Lavalink voice connection are ready", async () => {
  const player = {
    voice: {
      channelId: null,
      connected: false,
    },
  };

  const pending = waitForVoiceConnection(player, "voice-1", { timeoutMs: 100, pollMs: 1 });
  player.voice.channelId = "voice-1";
  player.voice.connected = true;

  await pending;
});

test("rejects when the voice handshake never completes", async () => {
  const player = {
    voice: {
      channelId: "voice-1",
      connected: false,
    },
  };

  await assert.rejects(
    waitForVoiceConnection(player, "voice-1", { timeoutMs: 10, pollMs: 1 }),
    /Voice connection was not established/
  );
});
