function waitForVoiceConnection(player, channelId, options = {}) {
  const timeoutMs = options.timeoutMs ?? 15_000;
  const pollMs = options.pollMs ?? 100;

  if (player.voice.channelId === channelId && player.voice.connected) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const interval = setInterval(() => {
      if (player.voice.channelId === channelId && player.voice.connected) {
        cleanup();
        resolve();
      }
    }, pollMs);

    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Voice connection was not established within ${timeoutMs}ms`));
    }, timeoutMs);

    function cleanup() {
      clearInterval(interval);
      clearTimeout(timeout);
    }
  });
}

module.exports = {
  waitForVoiceConnection,
};
