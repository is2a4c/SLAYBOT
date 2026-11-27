const test = require("node:test");
const assert = require("node:assert/strict");
require("module-alias/register");

const { hasMediaContent } = require("@helpers/media");

test("attachments and stickers count as media", () => {
  assert.equal(hasMediaContent({ attachments: new Map([["a", {}]]), embeds: [] }), true);
  assert.equal(hasMediaContent({ attachments: new Map(), stickers: new Map([["s", {}]]), embeds: [] }), true);
});

test("embeds with an image, video or thumbnail count as media", () => {
  assert.equal(hasMediaContent({ attachments: new Map(), embeds: [{ image: { url: "https://x/img.png" } }] }), true);
  assert.equal(hasMediaContent({ attachments: new Map(), embeds: [{ video: { url: "https://x/v.mp4" } }] }), true);
  assert.equal(
    hasMediaContent({ attachments: new Map(), embeds: [{ thumbnail: { url: "https://x/thumb.png" } }] }),
    true
  );
  assert.equal(
    hasMediaContent({ attachments: new Map(), embeds: [{ data: { image: { url: "https://x/raw.png" } } }] }),
    true
  );
});

test("text-only messages and plain link previews are not media", () => {
  assert.equal(hasMediaContent({ attachments: new Map(), embeds: [], content: "hello" }), false);
  assert.equal(hasMediaContent({ attachments: new Map(), embeds: [{ title: "article", url: "https://x" }] }), false);
  assert.equal(hasMediaContent(null), false);
});
