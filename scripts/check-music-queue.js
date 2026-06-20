#!/usr/bin/env node

require("module-alias/register");
require("@helpers/ConfigDefaults").applyConfigDefaults();
require("@handlers/lavaclient");

const { EventEmitter } = require("events");
const { Player } = require("lavaclient");

function createFakePlayer() {
  const fake = Object.create(Player.prototype);
  Object.assign(fake, new EventEmitter());
  fake.on = EventEmitter.prototype.on.bind(fake);
  fake.emit = EventEmitter.prototype.emit.bind(fake);
  fake.node = { emit() {} };
  fake.played = [];
  fake.play = async (track) => {
    fake.played.push(track);
  };
  return fake;
}

function track(id) {
  return {
    track: `encoded-${id}`,
    info: {
      title: `Track ${id}`,
      uri: `https://example.test/${id}`,
      length: 1000,
      identifier: id,
      author: "Smoke",
      isStream: false,
      position: 0,
      isSeekable: true,
      sourceName: "youtube",
    },
  };
}

async function waitForQueueHandler() {
  await new Promise((resolve) => setImmediate(resolve));
}

async function assertLavalinkV4ReasonStartsNext() {
  const player = createFakePlayer();
  const queue = player.queue;

  queue.add([track("one"), track("two")]);
  await queue.start();
  player.emit("trackEnd", { encoded: "encoded-one" }, "finished");
  await waitForQueueHandler();

  if (player.played.join(",") !== "encoded-one,encoded-two") {
    throw new Error(`expected lower-case finished to start next track, got ${JSON.stringify(player.played)}`);
  }
}

async function assertReplacedDoesNotStartNext() {
  const player = createFakePlayer();
  const queue = player.queue;

  queue.add([track("one"), track("two")]);
  await queue.start();
  player.emit("trackEnd", { encoded: "encoded-one" }, "replaced");
  await waitForQueueHandler();

  if (player.played.join(",") !== "encoded-one") {
    throw new Error(`expected replaced to leave queue alone, got ${JSON.stringify(player.played)}`);
  }
}

(async () => {
  await assertLavalinkV4ReasonStartsNext();
  await assertReplacedDoesNotStartNext();
  console.log("Music queue check passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
