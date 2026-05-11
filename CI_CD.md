# 🚀 CI/CD Documentation

## GitHub Actions Workflows

### 1. CI Pipeline (`.github/workflows/ci.yml`)
Запускается при каждом push/PR на `main` и `develop`.

**Шаги:**
- 🔍 **Lint & Format** — ESLint + Prettier проверка
- 📦 **Build Test** — проверка загрузки бота
- 🔒 **Security Audit** — npm audit + gitleaks (поиск секретов)

### 2. Deploy Pipeline (`.github/workflows/deploy.yml`)
Запускается при push на `main` или вручную через `workflow_dispatch`.

**Шаги:**
- 🚀 **Deploy to Server** — SSH деплой с PM2
- 📢 **Discord Notification** — webhook в Discord

---

## 🔑 GitHub Secrets Required

Зайди в **Settings → Secrets and variables → Actions** и добавь:

| Secret | Описание | Пример |
|--------|----------|--------|
| `BOT_TOKEN` | Токен Discord бота | `MTI2...` |
| `MONGO_CONNECTION` | MongoDB строка подключения | `mongodb+srv://...` |
| `ERROR_LOGS` | Webhook для логов ошибок | `https://discord.com/api/webhooks/...` |
| `JOIN_LEAVE_LOGS` | Webhook для join/leave | `https://discord.com/api/webhooks/...` |
| `BOT_SECRET` | Секрет для дашборда | `mysecret123` |
| `SESSION_PASSWORD` | Пароль для сессий | `password123` |
| `WEATHERSTACK_KEY` | API ключ Weatherstack | `abc123` |
| `STRANGE_API_KEY` | API ключ StrangeAPI | `xyz789` |
| `SPOTIFY_CLIENT_ID` | Spotify Client ID | `abc123` |
| `SPOTIFY_CLIENT_SECRET` | Spotify Client Secret | `xyz789` |
| `SERVER_HOST` | IP адрес сервера | `192.168.1.100` |
| `SERVER_USER` | SSH пользователь | `deploy` |
| `SERVER_PORT` | SSH порт | `22` |
| `SSH_PRIVATE_KEY` | SSH приватный ключ | `-----BEGIN OPENSSH...` |
| `DEPLOY_PATH` | Путь деплоя на сервере | `/opt/slaybot` |
| `DEPLOY_WEBHOOK` | Discord webhook для уведомлений | `https://discord.com/api/webhooks/...` |

---

## 🐳 Docker Deployment

### Build
```bash
npm run docker:build
# или
docker build -t slaybot .
```

### Run
```bash
# Скопируй .env.example → .env и заполни значения
npm run docker:run
# или
docker compose up -d
```

`docker-compose.yml` поднимает 2 сервиса: `bot` и `mongo`.
- `BOT_TOKEN` обязателен в `.env`
- `MONGO_CONNECTION` можно не задавать: по умолчанию используется `mongodb://mongo:27017/slaybot`
- Секреты не хранятся в репозитории: только в локальном `.env`

### Stop
```bash
npm run docker:stop
# или
docker compose down
```

---

## 🖥️ Server Deployment (PM2)

### Setup Server
```bash
# На сервере:
git clone https://github.com/PashaBritva/SLAYBOT.git
cd SLAYBOT

# Установи зависимости
npm ci --production

# Создай .env файл
cp .env.example .env
nano .env  # заполни значения

# Запусти через PM2
pm2 start bot.js --name slaybot
pm2 save
pm2 startup
```

### Quick Deploy
```bash
./deploy.sh
```

---

## 🔄 Local Development

```bash
# Install dependencies
npm install

# Run with auto-reload
npm run dev

# Lint code
npm run lint

# Fix lint issues
npm run lint:fix

# Check formatting
npm run format:check

# Auto-format
npm run format
```

---

## 📊 PM2 Commands

```bash
pm2 status              # Показать статус
pm2 logs slaybot        # Логи бота
pm2 restart slaybot     # Перезапуск
pm2 stop slaybot        # Остановка
pm2 monit               # Мониторинг ресурсов
```
