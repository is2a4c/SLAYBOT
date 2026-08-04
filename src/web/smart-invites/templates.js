const { SERVICE_NOTICE } = require("@src/services/smart-invites/constants");

const SITE_NAME = "SLAYBOT Smart Invites";
const BRAND_COLOR = "#a855f7";
const CARD_DESCRIPTION_LIMIT = 300;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character];
  });
}

/**
 * Only absolute http(s) URLs may reach a meta tag: a crawler resolves og:url
 * and og:image itself, so a relative or exotic value would either be dropped
 * by the crawler or point somewhere this service does not control.
 */
function absoluteURL(value) {
  if (typeof value !== "string" || !value) return null;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function metaTag(attribute, name, value) {
  return `  <meta ${attribute}="${escapeHtml(name)}" content="${escapeHtml(value)}">`;
}

function cardText(value) {
  const text = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > CARD_DESCRIPTION_LIMIT ? `${text.slice(0, CARD_DESCRIPTION_LIMIT - 1)}…` : text;
}

/**
 * Open Graph plus Twitter Card markup - the two vocabularies Discord, Telegram,
 * Twitter/X, Slack and the rest read to unfurl a pasted link into a card. They
 * fetch the page with a plain crawler that runs no JavaScript, so everything
 * the card shows has to be in this <head> already.
 * @param {{title: string, description: string, url?: string, image?: string, imageSize?: number, imageAlt?: string}} preview
 */
function previewMeta(preview) {
  const title = cardText(preview.title);
  const description = cardText(preview.description);
  const canonical = absoluteURL(preview.url);
  const image = absoluteURL(preview.image);
  const tags = [
    metaTag("name", "description", description),
    // Discord paints the card's left border with this colour.
    metaTag("name", "theme-color", BRAND_COLOR),
    metaTag("property", "og:type", "website"),
    metaTag("property", "og:site_name", SITE_NAME),
    metaTag("property", "og:title", title),
    metaTag("property", "og:description", description),
    metaTag("name", "twitter:card", "summary"),
    metaTag("name", "twitter:title", title),
    metaTag("name", "twitter:description", description),
  ];
  if (canonical) {
    tags.push(metaTag("property", "og:url", canonical));
    tags.push(`  <link rel="canonical" href="${escapeHtml(canonical)}">`);
  }
  if (image) {
    const size = Number.isInteger(preview.imageSize) ? preview.imageSize : null;
    tags.push(metaTag("property", "og:image", image));
    if (size) {
      tags.push(metaTag("property", "og:image:width", String(size)));
      tags.push(metaTag("property", "og:image:height", String(size)));
    }
    if (preview.imageAlt) tags.push(metaTag("property", "og:image:alt", cardText(preview.imageAlt)));
    tags.push(metaTag("name", "twitter:image", image));
  }
  return tags.join("\n");
}

function layout(title, content, preview = {}) {
  const meta = previewMeta({
    ...preview,
    title: preview.title || title,
    description: preview.description || SITE_NAME,
  });
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="dark">
  <title>${escapeHtml(title)}</title>
${meta}
  <style>
    :root{font-family:Inter,system-ui,sans-serif;color:#f7f4ff;background:#0d0a12}
    *{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:radial-gradient(circle at top,#302044,#0d0a12 60%)}
    main{width:min(620px,100%);background:#18131f;border:1px solid #3c2b4e;border-radius:20px;padding:clamp(24px,6vw,44px);box-shadow:0 24px 80px #0008}
    h1{margin:0 0 12px;font-size:clamp(28px,7vw,44px)}h2{margin:0 0 12px}.brand{color:#c58cff;font-weight:800;letter-spacing:.04em}
    p{line-height:1.65;color:#d4cadf}.muted{color:#a99bb8;font-size:.92rem}.button{display:inline-block;margin:14px 0;padding:13px 20px;border-radius:10px;background:#a855f7;color:white;text-decoration:none;font-weight:750}
    .icon{width:76px;height:76px;border-radius:24px;object-fit:cover}.meta{padding:12px 14px;background:#21182b;border-radius:12px;color:#d8cae8}
    nav{display:flex;gap:16px;flex-wrap:wrap;margin-top:28px}nav a{color:#c58cff}code{overflow-wrap:anywhere;color:#e4caff}
  </style>
</head>
<body><main>${content}<nav><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/abuse">Сообщить о нарушении</a></nav></main></body>
</html>`;
}

function renderHome(baseURL) {
  const description = "Постоянные человекопонятные страницы для приглашений на Discord-серверы.";
  return layout(
    "SLAYBOT Smart Invites",
    `<div class="brand">SLAYBOT</div><h1>Smart Invites</h1>
<p>${escapeHtml(description)}</p>
<p class="meta">Пример: <code>${escapeHtml(baseURL)}/my-server</code></p>
<p class="muted">Конкретная ссылка содержит slug, выбранный администратором сервера. Корневая страница никуда не перенаправляет.</p>`,
    { description, url: baseURL }
  );
}

function renderInvite({
  guildName,
  guildIcon,
  description,
  channelName,
  joinPath,
  canonicalURL,
  cardImage,
  cardImageSize,
}) {
  const icon = guildIcon ? `<img class="icon" src="${escapeHtml(guildIcon)}" alt="">` : "";
  // The channel is unknown when the page is built from cache alone (see the
  // crawler path in app.js), and an empty "Канал: #" line would be worse than none.
  const channel = channelName ? `<p class="meta">Канал: #${escapeHtml(channelName)}</p>` : "";
  return layout(
    `${guildName} — Smart Invite`,
    `${icon}<div class="brand">SLAYBOT SMART INVITE</div>
<h1>${escapeHtml(guildName)}</h1>
<p>${escapeHtml(description)}</p>
${channel}
<a class="button" href="${escapeHtml(joinPath)}" rel="nofollow">Вступить в Discord</a>
<p class="muted">${escapeHtml(SERVICE_NOTICE)}</p>`,
    {
      // The card is titled with the guild alone: chat clients already print
      // "SLAYBOT Smart Invites" above it from og:site_name.
      title: guildName,
      description,
      url: canonicalURL,
      image: cardImage || guildIcon,
      imageSize: cardImageSize,
      imageAlt: `Иконка сервера ${guildName}`,
    }
  );
}

function renderStatus(title, message, canonicalURL) {
  return layout(
    title,
    `<div class="brand">SLAYBOT SMART INVITES</div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p>`,
    { description: message, url: canonicalURL }
  );
}

function renderResource(title, message, url, label, canonicalURL) {
  const link = url
    ? `<a class="button" href="${escapeHtml(url)}" rel="noopener noreferrer">${escapeHtml(label)}</a>`
    : "";
  return layout(
    title,
    `<div class="brand">SLAYBOT SMART INVITES</div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p>${link}`,
    { description: message, url: canonicalURL }
  );
}

module.exports = {
  escapeHtml,
  layout,
  previewMeta,
  renderHome,
  renderInvite,
  renderResource,
  renderStatus,
};
