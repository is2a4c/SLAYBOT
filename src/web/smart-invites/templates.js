const { SERVICE_NOTICE } = require("@src/services/smart-invites/constants");

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

function layout(title, content) {
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="dark">
  <title>${escapeHtml(title)}</title>
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
  return layout(
    "SLAYBOT Smart Invites",
    `<div class="brand">SLAYBOT</div><h1>Smart Invites</h1>
<p>Постоянные человекопонятные страницы для приглашений на Discord-серверы.</p>
<p class="meta">Пример: <code>${escapeHtml(baseURL)}/my-server</code></p>
<p class="muted">Конкретная ссылка содержит slug, выбранный администратором сервера. Корневая страница никуда не перенаправляет.</p>`
  );
}

function renderInvite({ guildName, guildIcon, description, channelName, joinPath }) {
  const icon = guildIcon ? `<img class="icon" src="${escapeHtml(guildIcon)}" alt="">` : "";
  return layout(
    `${guildName} — Smart Invite`,
    `${icon}<div class="brand">SLAYBOT SMART INVITE</div>
<h1>${escapeHtml(guildName)}</h1>
<p>${escapeHtml(description)}</p>
<p class="meta">Канал: #${escapeHtml(channelName)}</p>
<a class="button" href="${escapeHtml(joinPath)}" rel="nofollow">Вступить в Discord</a>
<p class="muted">${escapeHtml(SERVICE_NOTICE)}</p>`
  );
}

function renderStatus(title, message) {
  return layout(
    title,
    `<div class="brand">SLAYBOT SMART INVITES</div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p>`
  );
}

function renderResource(title, message, url, label) {
  const link = url
    ? `<a class="button" href="${escapeHtml(url)}" rel="noopener noreferrer">${escapeHtml(label)}</a>`
    : "";
  return layout(
    title,
    `<div class="brand">SLAYBOT SMART INVITES</div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p>${link}`
  );
}

module.exports = {
  escapeHtml,
  layout,
  renderHome,
  renderInvite,
  renderResource,
  renderStatus,
};
