const crypto = require("crypto");

// Loading sharp is slow enough to be felt on the first captcha of a restart, so
// it is paid for at startup instead. It is optional: without it the challenge
// falls back to the SVG.
let sharp = null;
try {
  sharp = require("sharp");
} catch {
  sharp = null;
}

// Ambiguous glyphs (0/O, 1/I/l) are left out so a correct reading is never rejected.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const DEFAULT_LENGTH = 6;
const MIN_LENGTH = 4;
const MAX_LENGTH = 8;
const WIDTH = 340;
const HEIGHT = 120;

/**
 * @param {number} length
 */
function generateCode(length = DEFAULT_LENGTH) {
  const size = Math.min(MAX_LENGTH, Math.max(MIN_LENGTH, length));
  const bytes = crypto.randomBytes(size);
  let code = "";
  for (let i = 0; i < size; i += 1) code += ALPHABET[bytes[i] % ALPHABET.length];
  return code;
}

/**
 * Case-insensitive comparison that also tolerates the spaces people paste along
 * with the code. Constant-time is pointless here - the code is single-use and
 * short-lived - so readability wins.
 *
 * @param {string} expected
 * @param {string} received
 */
function matchesCode(expected, received) {
  const normalize = (value) =>
    String(value || "")
      .replace(/\s+/g, "")
      .toUpperCase();

  const left = normalize(expected);
  return left.length > 0 && left === normalize(received);
}

/**
 * Deterministic pseudo-random source so a code always renders the same way.
 * @param {string} seed
 */
function seededRandom(seed) {
  let state = crypto.createHash("sha256").update(seed).digest().readUInt32BE(0) || 1;
  return () => {
    // xorshift32
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0xffffffff;
  };
}

/**
 * Render the code as an SVG: rotated, offset glyphs over noise lines. Kept as a
 * string so it can be asserted in tests and rasterised without a browser.
 *
 * @param {string} code
 * @returns {string}
 */
function renderCaptchaSvg(code) {
  const random = seededRandom(code);
  const step = WIDTH / (code.length + 1);

  const glyphs = [...code]
    .map((char, index) => {
      const x = step * (index + 1) + (random() * 14 - 7);
      const y = HEIGHT / 2 + 18 + (random() * 16 - 8);
      const rotation = random() * 40 - 20;
      const size = 46 + random() * 12;
      return (
        `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-size="${size.toFixed(1)}" ` +
        `font-family="DejaVu Sans, Verdana, sans-serif" font-weight="bold" fill="#f4f4f5" ` +
        `transform="rotate(${rotation.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)})">${char}</text>`
      );
    })
    .join("");

  const lines = Array.from({ length: 6 }, () => {
    const x1 = random() * WIDTH;
    const y1 = random() * HEIGHT;
    const x2 = random() * WIDTH;
    const y2 = random() * HEIGHT;
    return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#a855f7" stroke-width="2" stroke-opacity="0.55"/>`;
  }).join("");

  const dots = Array.from({ length: 90 }, () => {
    const cx = random() * WIDTH;
    const cy = random() * HEIGHT;
    return `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${(random() * 1.8 + 0.5).toFixed(1)}" fill="#71717a"/>`;
  }).join("");

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">` +
    `<rect width="${WIDTH}" height="${HEIGHT}" fill="#18181b"/>${dots}${lines}${glyphs}</svg>`
  );
}

/**
 * Rasterise the challenge. Falls back to the raw SVG when sharp is unavailable,
 * so a missing native module degrades the image instead of breaking verification.
 *
 * @param {string} code
 * @returns {Promise<{attachment: Buffer, name: string}>}
 */
async function renderCaptchaImage(code) {
  const svg = renderCaptchaSvg(code);
  if (!sharp) return { attachment: Buffer.from(svg), name: "captcha.svg" };

  try {
    const png = await sharp(Buffer.from(svg)).png().toBuffer();
    return { attachment: png, name: "captcha.png" };
  } catch {
    return { attachment: Buffer.from(svg), name: "captcha.svg" };
  }
}

module.exports = {
  ALPHABET,
  DEFAULT_LENGTH,
  MAX_LENGTH,
  MIN_LENGTH,
  generateCode,
  matchesCode,
  renderCaptchaImage,
  renderCaptchaSvg,
};
