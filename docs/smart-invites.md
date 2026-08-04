# SLAYBOT Smart Invites

Smart Invites создают стабильный публичный адрес вида
`https://slaybot.televibe.host/my-server`. Постоянным является адрес SLAYBOT,
а не внутренний `discord.gg` invite: Discord-инвайт может быть удалён,
исчерпан или стать недоступным, после чего SLAYBOT безопасно заменит его.

Функция по умолчанию отключена и запускается только при
`SMART_INVITES.enabled: true`.

## Команды и разрешения

Все изменяющие `/smart-invite` команды требуют `Manage Server`. В выбранном
канале боту нужны `View Channel` и `Create Instant Invite`.

| Команда                                           | Действие                                                           |
| ------------------------------------------------- | ------------------------------------------------------------------ |
| `/smart-invite create slug channel [description]` | Создать страницу и бессрочный внутренний Discord-инвайт            |
| `/smart-invite list`                              | Показать только ссылки текущего guild                              |
| `/smart-invite info slug`                         | Показать описание, канал, статус и раздельные счётчики             |
| `/smart-invite refresh slug`                      | Принудительно заменить внутренний инвайт                           |
| `/smart-invite set-channel slug channel`          | Перенести ссылку на другой канал                                   |
| `/smart-invite set-description slug description`  | Изменить публичное описание                                        |
| `/smart-invite remove-description slug`           | Вернуть системное описание                                         |
| `/smart-invite rename slug new-slug`              | Переименовать ссылку; старый адрес сразу удаляется и освобождается |
| `/smart-invite delete slug`                       | Показать кнопки подтверждения и деактивировать ссылку              |

Owner-only `/smartinvite-admin` позволяет отключить ссылку, заблокировать или
разблокировать guild, посмотреть безопасный технический статус, снять
зависший lease и зарезервировать slug. Технический статус не показывает
внутренний Discord invite code.

## Slug, описание и Audit Log

Slug содержит 3–32 строчные латинские буквы, цифры и одиночные дефисы.
Пробелы, Unicode, точки, слеши, двойные дефисы и неоднозначно закодированные
пути отклоняются. Core reserved slugs и дополнительные
`SMART_INVITES.reservedSlugs` недоступны. `officialSlug` разрешён только
`officialGuildId`.

Описание необязательно и ограничено 200 символами. Оно хранится только в
MongoDB, не передаётся Discord как несуществующее поле invite description и
экранируется в HTML. Страница отдельно показывает неизменяемое пояснение о
том, что внутренний Discord-инвайт может измениться.

Для Discord Audit Log передаётся `reason`, сформированный
`buildSmartInviteAuditReason()`. Управляющие символы удаляются, значения
ограничиваются, а итог соблюдает лимит Discord Audit Log Reason.

## Открытие и восстановление

В режиме `preview` публичный route показывает имя и иконку guild, описание,
канал и кнопку. Кнопка ведёт на внутренний route SLAYBOT и только он создаёт
временный `302` на `https://discord.gg/{validatedCode}`. Поэтому код не
встраивается в preview, query-параметры не меняют destination и сервис не
является open redirect. В режиме `redirect` проверенный invite получает
немедленный `302`; `301` не используется.

Invite валидируется не чаще `validationTtlMs`. Удаление invite,
`channelDelete`, `guildDelete`, HTTP-запросы и фоновая очередь дополняют друг
друга, поэтому пропущенное во время рестарта событие обнаруживается позже.
Подтверждённый `Unknown Invite`, истечение или исчерпание max uses запускают
регенерацию. Временная ошибка Discord API не создаёт новый invite:
используется экспоненциальный backoff до `healthCheckIntervalMs`.

Регенерация получает атомарный MongoDB lease с owner ID и сроком. Запись
результата содержит fencing-проверку owner и expiry; процесс с истёкшим lease
удаляет созданный им лишний invite и не меняет MongoDB. Другие запросы кратко
ждут результат. Просроченные locks очищаются при старте.

Создание и замена синхронизируют существующий invite cache. Техническое
создание не увеличивает invite-tracking статистику. HTTP click, preview,
нажатие кнопки, redirect и фактическое вступление — разные события.
Фактический использованный код по-прежнему определяет существующий
`guildMemberAdd` tracker.

## Карточка ссылки в чатах

Каждая страница Smart Invite отдаёт Open Graph и Twitter Card разметку,
поэтому отправленный в Discord, Telegram, Slack или X адрес вида
`https://slaybot.televibe.host/my-server` разворачивается в карточку с именем
сервера, описанием и иконкой. Заголовок карточки — имя guild, `og:site_name` —
`SLAYBOT Smart Invites`, `og:image` — иконка сервера 256×256, `theme-color`
задаёт фиолетовую полосу Discord. Ничего настраивать не нужно: карточка
строится из тех же данных, что и сама страница, и меняется вместе с ними.

Клиенты чатов запрашивают страницу собственным crawler; такой запрос
распознаётся по `User-Agent` и обрабатывается отдельно. Он получает только
разметку карточки: клик не засчитывается, invite не валидируется и не
регенерируется, поэтому вставка ссылки в чат не обращается к Discord API.
В режиме `redirect` crawler тоже получает карточку вместо `302`, иначе чат
показал бы плашку самого `discord.gg`, а не сервера.

Описание в карточке — то же публичное описание ссылки, поэтому
`/smart-invite set-description` меняет и текст плашки. Кэш карточки живёт на
стороне мессенджера: Discord обновляет её не сразу, и для проверки удобно
добавить к адресу временный `?v=2`.

## Конфигурация

Скопируйте секцию `SMART_INVITES` из `example.config.js`. Основные параметры:

- `baseURL` — канонический URL без доверия заголовку `Host`;
- `host`/`port` — локальный listener, по умолчанию `127.0.0.1:8081`;
- `maxPerGuild` — лимит активных ссылок, по умолчанию 5;
- `redirectMode` — `preview` или `redirect`;
- validation, scheduler, lease и deleted-slug retention intervals;
- reserved и blocked guild lists;
- rate-limit window/max и concurrency фоновой очереди.

В production публичный `baseURL` должен использовать HTTPS. HTTP разрешён для
localhost и тестов. Смена `baseURL` меняет все вычисляемые публичные адреса
без миграции документов.

## DNS, HTTPS и reverse proxy

Создайте DNS record для `slaybot.televibe.host`, направленный на реальный
server, и фактически выпустите TLS-сертификат до включения HTTPS listener.
Ни DNS, ни сертификат не создаются кодом SLAYBOT.

Пример Nginx:

```nginx
server {
    listen 80;
    server_name slaybot.televibe.host;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name slaybot.televibe.host;

    ssl_certificate /etc/letsencrypt/live/slaybot.televibe.host/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/slaybot.televibe.host/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8081;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_connect_timeout 5s;
        proxy_read_timeout 15s;
        proxy_send_timeout 15s;
    }
}
```

Пути `/etc/letsencrypt/...` действительны только после фактического выпуска
сертификата для домена.

Минимальный Caddy:

```caddy
slaybot.televibe.host {
    reverse_proxy 127.0.0.1:8081
}
```

## Эксплуатация, backup и диагностика

HTTP runtime использует уже открытое Mongoose-соединение. Повторный start в
одном процессе идемпотентен. При `SIGINT`/`SIGTERM` listener перестаёт
принимать запросы, scheduler останавливается, незавершённая работа получает
ограниченное время, затем закрывается MongoDB.

```bash
curl -i https://slaybot.televibe.host/health
curl -i https://slaybot.televibe.host/example
pm2 logs slaybot
```

Health response минимален и не раскрывает config или IDs. Структурированные
events начинаются с `smart_invite_`; invite code, токены, Mongo URI, cookies,
headers и полный IP не логируются приложением.

Reverse proxy обычно пишет IP в access log. Настройте срок хранения,
ограничьте доступ и согласуйте это с Privacy Policy. In-process rate limiter
обрабатывает IP только как HMAC-ключ с runtime salt и не пишет его в log.

Резервное копирование MongoDB должно включать `smart_invites` и
`smart_invite_controls`. Восстановление проверяют в отдельной базе; не
восстанавливайте поверх production без точки отката.

## Ручной smoke test

1. Включить функцию в test environment и пройти `npm run runtime:check`.
2. Создать `/smart-invite create` с безопасным channel и description.
3. Открыть preview, проверить CSP и отсутствие invite code в HTML.
   Отдельно запросить страницу с `User-Agent: Discordbot/2.0` и убедиться,
   что вернулись `og:title`, `og:image` и `og:url`, а счётчик кликов не вырос.
4. Нажать кнопку и убедиться, что получен временный redirect только на
   `discord.gg`.
5. Удалить внутренний invite в Discord и одновременно открыть страницу
   несколькими запросами: должен появиться ровно один новый invite, а
   публичный URL не измениться.
6. Проверить `/smart-invite info`, немедленное удаление старого адреса после rename и delete confirmation.
7. Убедиться, что удалённый slug нельзя создать до окончания retention.
8. Отключить функцию и убедиться, что Discord-бот запускается без HTTP
   listener.

Перед production отдельно проверить DNS, сертификат, reverse proxy,
firewall, MongoDB backup, Discord permissions, глобальную регистрацию
slash-команд и реальный переход внешним браузером.
