# Межсерверная экосистема Slaybot

**Author:** is2a4c
**Date:** 2026-07-29
**Status:** Approved
**Reviewers:** владелец Slaybot — одобрено запросом на разработку межсерверной экосистемы

## Context

Slaybot уже хранит кошелёк и репутацию по Discord user ID без привязки к конкретному серверу, поэтому баланс пользователя фактически является межсерверным. XP, сообщения и существующий XP-лидерборд, напротив, изолированы по серверу и не образуют общей мета-игры.

Первый релиз экосистемы должен соединить существующую общую экономику с ежемесячным сезоном. Пользователи получают сезонные очки за XP, заработанный в разрешённой сервером системе статистики, видят общий профиль и соревнуются как лично, так и командами серверов. Решение должно работать внутри текущего процесса бота и общей MongoDB без отдельного сервиса.

## Functional Requirements

- FR-1: Система MUST определять активный сезон как календарный месяц UTC и возвращать его стабильный ID, дату начала и дату окончания.
- FR-2: Система MUST учитывать только положительный XP, который уже прошёл существующие проверки AutoMod и cooldown.
- FR-3: Система MUST атомарно накапливать сезонные очки и показатели в разрезе `season_id + guild_id + user_id`.
- FR-4: Повторная обработка одного Discord message ID MUST NOT начислять сезонные очки второй раз.
- FR-5: Система MUST строить общий лидерборд игроков суммированием результатов пользователя со всех серверов активного сезона.
- FR-6: Система MUST строить общий лидерборд серверов суммированием результатов всех участников сервера активного сезона.
- FR-7: Система MUST строить лидерборд богатства из существующих глобальных полей `User.coins + User.bank`, не создавая второй кошелёк.
- FR-8: Команда `global profile` MUST показывать глобальный баланс и суммарный результат пользователя в активном сезоне.
- FR-9: Команда `global leaderboard` MUST поддерживать таблицы `players`, `servers` и `wealth`.
- FR-10: Команда `global season` MUST показывать границы активного сезона и объяснять способ начисления очков.
- FR-11: Prefix- и slash-варианты команды MUST возвращать одинаковые данные для одинакового пользователя и сезона.
- FR-12: Система SHOULD хранить неизменяемое событие начисления для аудита и дедупликации.
- FR-13: После завершения сезона система MUST рассчитывать денежную награду за личный топ, личный порог и победу сервера.
- FR-14: Личный топ MUST выдавать 25 000 монет за первое место, 15 000 за второе, 10 000 за третье и 5 000 за места 4–10.
- FR-15: Личный прогресс MUST выдавать одну максимальную достигнутую пороговую награду: 500 очков — 500 монет, 2 000 очков — 2 000 монет, 7 500 очков — 7 500 монет.
- FR-16: Участник сервера-победителя с вкладом не менее 100 очков MUST получить 5 000 монет и постоянный титул серверного чемпиона.
- FR-17: Личные места и пороги MUST выдавать постоянные сезонные титулы, отображаемые в глобальном профиле.
- FR-18: Награда сезона MUST начисляться в общий банк пользователя не более одного раза, включая параллельные повторные запросы.
- FR-19: Команда `global rewards` MUST показывать результат предыдущего завершённого сезона и состав доступного приза.
- FR-20: Команда `global claim` MUST получать приз предыдущего завершённого сезона либо сообщать, что награда уже получена или не заработана.

## Non-Functional Requirements

- NFR-1: Запись сезонной активности MUST использовать не более двух MongoDB операций на одно XP-начисление.
- NFR-2: Лидерборд MUST ограничивать выдачу десятью строками, чтобы помещаться в Discord embed.
- NFR-3: Сбой экосистемного учёта MUST NOT отменять уже сохранённую локальную статистику или блокировать обработку сообщения.
- NFR-4: Все денежные значения и очки MUST оставаться безопасными целыми числами JavaScript.
- NFR-5: Новые MongoDB коллекции MUST иметь уникальные индексы дедупликации и индексы сортировки лидербордов.
- NFR-6: Выдача награды MUST быть атомарной на документе пользователя и не требовать MongoDB transaction/replica set.
- NFR-7: Награда MUST складываться из независимых компонентов с предсказуемым верхним пределом 37 500 монет за сезон.

## Acceptance Criteria

### AC-1: Границы сезона (FR-1)

**Given** произвольная дата внутри месяца
**When** сервис вычисляет активный сезон
**Then** ID равен `YYYY-MM`, начало равно первому дню месяца 00:00:00 UTC, конец равен первому дню следующего месяца.

### AC-2: Единственное начисление за сообщение (FR-2, FR-3, FR-4, FR-12, NFR-1, NFR-5)

**Given** разрешённое сообщение с положительным XP и уникальным message ID
**When** обработчик дважды передаёт одно событие
**Then** сезонный счёт пользователя и сервера увеличивается ровно один раз, а событие хранится в единственном экземпляре.

### AC-3: Запрещённая активность (FR-2, NFR-3)

**Given** сообщение, заблокированное AutoMod, command-like noise или сообщение на XP cooldown
**When** локальная статистика обрабатывает сообщение
**Then** межсерверные очки не начисляются.

### AC-4: Общий рейтинг игроков (FR-5, NFR-2)

**Given** пользователь заработал очки на двух серверах в одном сезоне
**When** запрашивается таблица `players`
**Then** очки суммируются по user ID, строки сортируются по очкам и ограничиваются десятью.

### AC-5: Соревнование серверов (FR-6, NFR-2)

**Given** несколько участников заработали очки на одном сервере
**When** запрашивается таблица `servers`
**Then** очки суммируются по guild ID, а сервер занимает позицию по общей сумме.

### AC-6: Единая экономика (FR-7, FR-8, NFR-4)

**Given** у пользователя есть `coins` и `bank`, заработанные на любом сервере
**When** он открывает глобальный профиль или таблицу `wealth` с другого сервера
**Then** отображается тот же кошелёк, а капитал равен безопасной целой сумме `coins + bank`.

### AC-7: Командный интерфейс (FR-8, FR-9, FR-10, FR-11)

**Given** зарегистрированная команда `global`
**When** пользователь вызывает каждый subcommand через prefix или slash
**Then** команда маршрутизирует запрос в один общий presenter/service и возвращает профиль, нужный лидерборд или описание сезона.

### AC-8: Отказ MongoDB (NFR-3)

**Given** локальная XP-запись успешно сохранена, но запись экосистемы завершилась ошибкой
**When** обработчик сообщения заканчивает работу
**Then** ошибка журналируется, но не выбрасывается в основной message pipeline.

### AC-9: Приз личного рейтинга (FR-13, FR-14, FR-17, NFR-7)

**Given** завершённый сезон и пользователь в первой десятке
**When** система рассчитывает результат сезона
**Then** она добавляет соответствующую месту денежную награду и постоянный титул личного рейтинга.

### AC-10: Достижимая цель для каждого (FR-13, FR-15, FR-17, NFR-7)

**Given** пользователь не вошёл в топ-10, но достиг сезонного порога
**When** система рассчитывает результат сезона
**Then** она выдаёт одну максимальную достигнутую пороговую награду и соответствующий титул.

### AC-11: Серверный кубок (FR-13, FR-16, FR-17, NFR-7)

**Given** сервер занял первое место и пользователь принёс ему не менее 100 очков
**When** система рассчитывает результат сезона
**Then** пользователь получает 5 000 монет и постоянный титул чемпиона сервера.

### AC-12: Однократное получение (FR-18, FR-19, FR-20, NFR-4, NFR-6)

**Given** пользователь заработал приз завершённого сезона
**When** два запроса `global claim` выполняются последовательно или параллельно
**Then** общий банк увеличивается ровно один раз, ID сезона записывается в `claimed_seasons`, а повторный запрос сообщает об уже полученной награде.

## Edge Cases

- EC-1: Нулевой, отрицательный, дробный или превышающий `Number.MAX_SAFE_INTEGER` XP отклоняется без записи.
- EC-2: Событие без Discord message ID, guild ID или user ID отклоняется как невалидное.
- EC-3: Удалённый пользователь в лидерборде отображается по стабильному user ID, а не удаляется из результата.
- EC-4: Сервер, которого больше нет в cache бота, отображается по стабильному guild ID.
- EC-5: Пустой сезон или пустой экономический рейтинг возвращает понятное сообщение, а не пустой embed.
- EC-6: Переход декабря в январь формирует ID следующего года и корректную дату окончания.
- EC-7: Дублирующее событие считается успешным no-op и не создаёт ошибку в message pipeline.
- EC-8: Пользователь без награды получает нулевой preview и не создаёт запись о получении.
- EC-9: Пользователь, участвовавший на нескольких серверах, получает серверную награду только если внёс минимум 100 очков именно в сервер-победитель.
- EC-10: Результаты текущего незавершённого сезона не могут быть получены досрочно.
- EC-11: Одновременные claim-запросы не создают второй документ пользователя и не удваивают банк.

## API Contracts

HTTP API отсутствует: первый релиз работает через Discord command contract и внутренний service API.

```ts
interface SeasonWindow {
  id: string;
  startsAt: Date;
  endsAt: Date;
}

interface ActivityInput {
  eventId: string;
  guildId: string;
  userId: string;
  xp: number;
  occurredAt?: Date;
}

interface ActivityResult {
  applied: boolean;
  seasonId: string;
  points: number;
}

interface LeaderboardRow {
  id: string;
  points: number;
  xp: number;
  messages: number;
}

interface GlobalProfile {
  userId: string;
  seasonId: string;
  points: number;
  xp: number;
  messages: number;
  coins: number;
  bank: number;
  netWorth: number;
  titles: Array<{ id: string; label: string; seasonId: string }>;
}

interface SeasonRewardPreview {
  seasonId: string;
  points: number;
  playerRank: number | null;
  championGuildId: string | null;
  amount: number;
  titles: Array<{ id: string; label: string; seasonId: string }>;
  breakdown: Array<{ source: "rank" | "milestone" | "server"; amount: number }>;
}

interface SeasonClaimResult {
  claimed: boolean;
  reason?: "NO_REWARD" | "ALREADY_CLAIMED";
  preview: SeasonRewardPreview;
  bank: number;
}
```

Discord command contract:

```text
/global profile [user]
/global leaderboard <players|servers|wealth>
/global season
/global rewards
/global claim
<prefix>global profile [user]
<prefix>global leaderboard <players|servers|wealth>
<prefix>global season
<prefix>global rewards
<prefix>global claim
```

## Data Models

### EcosystemActivity

| Field | Type | Constraints |
|---|---|---|
| event_id | String | required, unique; Discord message ID |
| season_id | String | required, indexed, `YYYY-MM` |
| guild_id | String | required, indexed |
| user_id | String | required, indexed |
| xp | Number | required, positive safe integer |
| points | Number | required, positive safe integer |
| occurred_at | Date | required |
| created_at | Date | generated timestamp |

### EcosystemStanding

| Field | Type | Constraints |
|---|---|---|
| season_id | String | required, compound unique |
| guild_id | String | required, compound unique |
| user_id | String | required, compound unique |
| points | Number | default 0, non-negative safe integer |
| xp | Number | default 0, non-negative safe integer |
| messages | Number | default 0, non-negative safe integer |
| last_activity_at | Date | required |
| created_at | Date | generated timestamp |
| updated_at | Date | generated timestamp |

### User

| Field | Type | Constraints |
|---|---|---|
| `_id` | String | existing Discord user ID |
| coins | Number | existing global wallet value |
| bank | Number | existing global bank value |
| ecosystem.claimed_seasons | String[] | unique season IDs claimed by this user |
| ecosystem.titles | Embedded[] | permanent earned title ID, label, season ID and timestamp |

## Out of Scope

- OS-1: Межботовая федерация нескольких независимых установок Slaybot не входит в MVP; все серверы обслуживаются одной установкой и MongoDB.
- OS-2: Магазин, NFT, вывод реальных денег и платёжные интеграции не входят в MVP.
- OS-3: Ручная панель создания произвольных турниров не входит в MVP; соревнование является ежемесячным сезоном.
- OS-4: Автоматическая выдача Discord-ролей не входит в MVP; награды существуют внутри общей экономики и глобального профиля.
- OS-5: Переписывание существующих economy-команд и миграция балансов не входят в MVP, поскольку `User` уже глобален.
