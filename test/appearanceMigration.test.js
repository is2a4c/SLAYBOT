const test = require("node:test");
const assert = require("node:assert/strict");
require("module-alias/register");

const mongoose = require("mongoose");
const { EmbedBuilder } = require("discord.js");
const { MongoMemoryServer } = require("mongodb-memory-server");
const {
  COLOR_PATHS,
  URL_PATHS,
  clearUnusableAppearance,
  isUsableColor,
  isUsableUrl,
  unusablePaths,
} = require("@src/database/migrations");

/* --------------------------------------------------------------- the rules */

test("a colour is judged by whether Discord can actually use it", () => {
  // Named colours are valid, so this cannot be a hex pattern check.
  for (const usable of ["#A855F7", "a855f7", "Red", "Blue", 0xa855f7, null, ""]) {
    assert.equal(isUsableColor(usable), true, `${JSON.stringify(usable)} should be kept`);
    if (usable !== null && usable !== "") {
      assert.doesNotThrow(() => new EmbedBuilder().setColor(usable), `${JSON.stringify(usable)} throws in an embed`);
    }
  }

  for (const broken of ["синий", "blue", "not-a-colour", "#12345", "#GGGGGG"]) {
    assert.equal(isUsableColor(broken), false, `${JSON.stringify(broken)} should be cleared`);
    assert.throws(() => new EmbedBuilder().setColor(broken), `${JSON.stringify(broken)} is fine after all`);
  }
});

test("an image has to be an https link", () => {
  assert.equal(isUsableUrl("https://example.com/a.png"), true);
  assert.equal(isUsableUrl(null), true);
  assert.equal(isUsableUrl(""), true);

  assert.equal(isUsableUrl("http://example.com/a.png"), false);
  assert.equal(isUsableUrl("javascript:alert(1)"), false);
  assert.equal(isUsableUrl("not a url"), false);
});

test("only the broken paths of a document are listed", () => {
  const document = {
    welcome: { embed: { color: "синий", image: "https://example.com/a.png" } },
    farewell: { embed: { color: "#FF0000" } },
    branding: { color: "Red", iconURL: "http://insecure.example/a.png" },
  };

  assert.deepEqual(unusablePaths(document), ["welcome.embed.color", "branding.iconURL"]);
  assert.deepEqual(unusablePaths({}), [], "a guild with nothing configured is left alone");
});

/* ------------------------------------------------------------ against mongo */

test("the migration clears what cannot be used and leaves the rest", async () => {
  const mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());

  const { model } = require("@schemas/Guild");

  try {
    await model.create([
      {
        _id: "111111111111111111",
        welcome: { enabled: true, channel: "1", embed: { color: "синий", image: "http://insecure/a.png" } },
        branding: { color: "Red", name: "Kept" },
      },
      {
        _id: "222222222222222222",
        farewell: { embed: { color: "#FF0000" } },
        starboard: { color: "not-a-colour" },
      },
      { _id: "333333333333333333", welcome: { embed: { color: "#A855F7" } } },
    ]);

    const result = await clearUnusableAppearance(model);

    assert.equal(result.scanned, 3);
    assert.equal(result.repaired, 2, "the third guild had nothing wrong with it");
    assert.deepEqual(result.cleared, {
      "welcome.embed.color": 1,
      "welcome.embed.image": 1,
      "starboard.color": 1,
    });

    const first = await model.findById("111111111111111111").lean();
    assert.equal(first.welcome.embed.color, null);
    assert.equal(first.welcome.embed.image, null);
    assert.equal(first.welcome.enabled, true, "the rest of the greeting survives");
    assert.equal(first.branding.color, "Red", "a named colour Discord accepts is kept");
    assert.equal(first.branding.name, "Kept");

    const second = await model.findById("222222222222222222").lean();
    assert.equal(second.farewell.embed.color, "#FF0000");
    assert.equal(second.starboard.color, null);

    const third = await model.findById("333333333333333333").lean();
    assert.equal(third.welcome.embed.color, "#A855F7");

    // Running it again must find nothing left to do.
    const second_run = await clearUnusableAppearance(model);
    assert.equal(second_run.repaired, 0);
    assert.deepEqual(second_run.cleared, {});
  } finally {
    await mongoose.disconnect();
    await mongo.stop();
  }
});

test("every colour and image setting in the schema is covered", () => {
  const schema = mongoose.model("guild").schema;

  for (const path of [...COLOR_PATHS, ...URL_PATHS]) {
    assert.ok(schema.path(path), `the migration touches "${path}", which the schema does not have`);
  }

  // Anything named like a colour has to be on the list, or it goes unrepaired.
  const declared = [];
  schema.eachPath((path, type) => {
    if (type.instance === "String" && /(^|\.)(color|iconURL|image)$/.test(path)) declared.push(path);
  });

  assert.deepEqual(
    declared.sort(),
    [...COLOR_PATHS, ...URL_PATHS].sort(),
    "a colour or image setting was added to the schema without being covered here"
  );
});
