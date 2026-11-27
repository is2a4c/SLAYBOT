const EMBED_MEDIA_KEYS = ["image", "video", "thumbnail"];

/**
 * Whether a message carries media: files, stickers, or an embed with an image,
 * video or thumbnail. Plain link previews without any of those are not media.
 *
 * @param {object} message
 * @returns {boolean}
 */
function hasMediaContent(message) {
  if (!message) return false;
  if ((message.attachments?.size || 0) > 0) return true;
  if ((message.stickers?.size || 0) > 0) return true;

  return (
    Array.isArray(message.embeds) &&
    message.embeds.some((embed) =>
      EMBED_MEDIA_KEYS.some((key) => Boolean(embed?.[key]?.url || embed?.data?.[key]?.url))
    )
  );
}

module.exports = { EMBED_MEDIA_KEYS, hasMediaContent };
