---
description: starboard, sticky messages, polls, reminders, birthdays, verification, modmail, feeds, events, backups and the status page
---

# ✨ Engagement & Community

Everything a server expects a general-purpose bot to already do. All of it is
per-server configuration; nothing here needs a restart.

## Durable timers

Temporary roles, reminders, birthday announcements, poll deadlines and event
reminders share one scheduler backed by MongoDB (`scheduled_tasks`). Two
consequences worth knowing:

- A deadline that falls while the bot is offline fires on the next poll instead of
  being lost.
- Re-arming the same thing (extending a temporary role, moving a birthday
  announcement) replaces the pending timer rather than stacking a second one.

Poll interval, batch size and lease are configured under `SCHEDULER` in
`config.js`; the defaults poll every 15 seconds.

## Starboard

Mirrors messages the server stars into a highlight channel.

| Command                                   | Description                               |
| ----------------------------------------- | ----------------------------------------- |
| **/starboard channel channel:**           | pick the channel and enable the starboard |
| **/starboard config ...**                 | emoji, threshold, self-star, bots, colour |
| **/starboard ignore / unignore channel:** | exclude a channel from being mirrored     |
| **/starboard status**                     | show the configuration                    |
| **/starboard top**                        | the most starred messages                 |
| **/starboard off**                        | disable it (entries are kept)             |
| **/starboard purge**                      | forget every stored entry                 |

Defaults: ⭐, three reactions, the author's own star counts, bot messages are
skipped. `remove_below:false` keeps a mirror once it has been posted even if the
count falls again. Deleting a mirror by hand blocks that message from coming
back, and deleting the original removes its mirror.

## Sticky messages

Keeps a message at the bottom of a channel.

| Command                                                                     | Description                     |
| --------------------------------------------------------------------------- | ------------------------------- |
| **/sticky set channel: message: [title] [plain] [min_messages] [cooldown]** | set or replace the sticky       |
| **/sticky remove channel:**                                                 | remove it                       |
| **/sticky list**                                                            | list every sticky of the server |

`min_messages` (default 1) and `cooldown` (default 5s) stop the sticky from
re-posting on every single message. Use `\n` for line breaks; `plain:true` posts
text instead of an embed. Needs `Manage Messages` so the previous copy can be
deleted.

## Polls

| Command                                                                                | Description                  |
| -------------------------------------------------------------------------------------- | ---------------------------- |
| **/poll create question: options: [multi] [duration] [show_voters] [final] [channel]** | start a poll                 |
| **/poll list**                                                                         | open polls of the server     |
| **/poll close message_id:**                                                            | close it and show the result |

Options are separated by `|`, up to ten. Members vote through the dropdown and
results update live. `multi` allows several answers, `final` forbids changing a
vote, `show_voters` reveals who voted for what, and `duration` closes the poll on
its own. The poll author and anyone with `Manage Messages` can close a poll.

## Reminders

| Command                                | Description                         |
| -------------------------------------- | ----------------------------------- |
| **/remind me in: about: [dm] [every]** | remind you in this channel or by DM |
| **/remind list**                       | your pending reminders              |
| **/remind cancel number:**             | cancel one from the list            |

Prefix form: `!remind 2h check the deploy`, `!remind list`, `!remind cancel 1`.
Delays run from 30 seconds to a year, 25 reminders per member, and `every`
repeats the reminder (minimum five minutes). If the channel is gone when the
reminder fires it is delivered as a DM.

## Birthdays

| Command                                                                     | Description                   |
| --------------------------------------------------------------------------- | ----------------------------- |
| **/birthday set day: month: [year]**                                        | save your birthday            |
| **/birthday remove**                                                        | delete it                     |
| **/birthday show [user]**                                                   | show a saved birthday         |
| **/birthday list**                                                          | upcoming birthdays            |
| **/birthday config status: [channel] [message] [role] [hour] [utc_offset]** | announcements (Manage Server) |

The year is optional and only used to show an age. Announcements run once per day
at the configured local hour, and each birthday is announced once per year even
if the bot restarts. A configured role is handed out for 24 hours through the same
temporary-role machinery. Placeholders: `{member}`, `{name}`, `{age}`, `{server}`.

## Verification & captcha

| Command                                                                           | Description                      |
| --------------------------------------------------------------------------------- | -------------------------------- |
| **/verification setup channel: role: [mode] [title] [description] [remove_role]** | post the panel and enable it     |
| **/verification config ...**                                                      | mode, captcha length, roles, log |
| **/verification status**                                                          | show the configuration           |
| **/verification off**                                                             | disable it                       |

`mode:button` grants the role on click. `mode:captcha` shows a generated image
(4-8 characters, ambiguous glyphs excluded), asks for the code in a modal and
allows three attempts before a new code is needed. Challenges expire after ten
minutes. `remove_role` is usually an `Unverified` role that gates the rest of the
server. Everything the member sees is ephemeral.

## Modmail

Members DM the bot, staff answer in a private thread.

| Command                                                               | Description                          |
| --------------------------------------------------------------------- | ------------------------------------ |
| **/modmail setup channel: [staff_role] [anonymous] [mirror_replies]** | enable it (Manage Server)            |
| **/modmail contact message:**                                         | open a thread from inside the server |
| **/modmail reply message:**                                           | reply to the member of this thread   |
| **/modmail close [reason]**                                           | close the thread                     |
| **/modmail block / unblock user:**                                    | stop or allow a member               |
| **/modmail list**                                                     | open threads                         |
| **/modmail status**                                                   | show the configuration               |

With `mirror_replies` on (the default) anything staff type in the thread is
forwarded to the member, except messages starting with `.` — those stay internal.
`anonymous` replaces the staff name with the server name. A member who shares
several modmail servers with the bot is asked to use `/modmail contact` in the
right one.

## Feeds — Twitch, YouTube, RSS, GitHub

| Command                                                   | Description                           |
| --------------------------------------------------------- | ------------------------------------- |
| **/feeds add type: target: channel: [mention] [message]** | watch a source                        |
| **/feeds remove type: target: [channel]**                 | stop watching                         |
| **/feeds list**                                           | configured feeds and their last error |
| **/feeds test type: target:**                             | fetch a source without saving it      |

Targets: a Twitch login (`ninja` or its url), a YouTube channel id (`UC…`),
`owner/repo` for GitHub, or a feed url for RSS/Atom. Adding a feed adopts the
current item silently, so setup never dumps a backlog into the channel. Each
source is polled every five minutes (`FEEDS.pollIntervalMs`), and a feed that
fails ten times in a row is paused with the reason kept in `/feeds list`.

- **Twitch** needs `TWITCH_CLIENT_ID` and `TWITCH_CLIENT_SECRET`.
- **YouTube** uses the public Atom feed: no API key, no quota.
- **GitHub** announces releases, falling back to commits for repositories without
  releases; `GITHUB_TOKEN` is optional and only raises the rate limit.

## Scheduled events

| Command                                                                                                                       | Description                     |
| ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| **/event create name: starts_in: [voice_channel\|location] [duration] [description] [announce_in] [remind_before] [mention]** | create a native Discord event   |
| **/event list**                                                                                                               | upcoming events                 |
| **/event cancel event_id:**                                                                                                   | cancel it and drop its reminder |

Events are real Discord scheduled events, so members get the RSVP list and
Discord's own notification. `announce_in` posts an embed right away and
`remind_before` schedules a reminder in that channel. An event at an external
`location` needs a `duration`.

## Backups

| Command                        | Description                                              |
| ------------------------------ | -------------------------------------------------------- |
| **/backup create [name]**      | snapshot roles, channels, overwrites and server settings |
| **/backup list**               | stored snapshots (five newest are kept)                  |
| **/backup info id:**           | what a snapshot contains                                 |
| **/backup load id: [confirm]** | re-create what the server is missing                     |
| **/backup delete id:**         | delete a snapshot                                        |

Requires `Administrator`. Snapshots hold structure only — never messages or
member data. **A restore only adds**: it creates missing roles, categories and
channels (with role-name-based permission overwrites) and never renames, moves or
deletes anything that already exists, so a mistaken `/backup load` cannot wipe a
live server. Without `confirm:true` the command only reports what it would create.

## Webhooks

| Command                                                      | Description                              |
| ------------------------------------------------------------ | ---------------------------------------- |
| **/webhook create channel: name: [avatar] [show_url]**       | create a webhook                         |
| **/webhook list [channel]**                                  | list webhooks of a channel or the server |
| **/webhook delete channel: name:**                           | delete one                               |
| **/webhook send channel: name: message: [embed] [username]** | post through it                          |

Webhook URLs are credentials: they are never listed and only shown when
`show_url:true` is passed, in an ephemeral reply. Messages sent through a webhook
can never ping `@everyone`.

## Server branding

`/embed branding` makes the bot's own embeds look like the server's, without a
separate Discord application.

| Option   | Effect                                           |
| -------- | ------------------------------------------------ |
| `name`   | name shown in embed footers (max 60 characters)  |
| `color`  | accent colour as a hex value, e.g. `#A855F7`     |
| `footer` | footer text (max 120 characters)                 |
| `icon`   | https URL of the footer icon                     |
| `reset`  | clear everything and go back to the bot defaults |

`/embed branding` with no options shows the current setup, and `/embed send`
still opens the interactive embed builder. Branding applies to the neutral
embeds the bot posts — self role panels, verification panels, sticky messages and
similar. Embeds that carry meaning through colour (errors, warnings, moderation
logs) keep their own colour, and a panel with an explicit colour keeps it too.
Requires **Manage Server**.

## Advanced giveaways

`/giveaway start` accepts entry requirements on top of the channel:

| Option            | Effect                                                    |
| ----------------- | --------------------------------------------------------- |
| `min_level`       | minimum XP level                                          |
| `min_invites`     | minimum effective invites (tracked + added − fake − left) |
| `min_account_age` | minimum Discord account age in days                       |
| `min_server_days` | minimum days on this server                               |
| `blocked_role`    | role that may never enter                                 |
| `bonus_role`      | role that gets extra entries                              |
| `bonus_entries`   | how many entries that role gets (2-10, default 2)         |

The role field inside the setup modal still restricts entry to specific roles.
Requirements are listed in the giveaway message, so members can see why they
cannot enter. A failed database lookup never disqualifies anyone — the entry is
allowed rather than silently dropped.

## Multilingual dashboard

The dashboard ships Russian and English. The language comes from `?lang=ru` /
`?lang=en` (remembered in a cookie for a year), otherwise from the browser's
`Accept-Language`, otherwise Russian. Every page carries a `RU / EN` switch in
the header.

Adding a language means one file: copy `dashboard/i18n/locales/ru.js`, translate
the values and register it in `dashboard/i18n/index.js`. A test enforces that all
locales define exactly the same keys and that no template contains a hardcoded
string, so a half-translated language cannot ship unnoticed.

## Status page

The dashboard exposes a public status page at `<dashboard base URL>/status` and a
machine-readable `<…>/status/status.json` that answers `503` while the service is
down, which is what an uptime monitor needs.

It reports the gateway, the database, the scheduler and the feed watcher, plus
uptime, shard latency, memory and counts. The payload deliberately contains no
guild names or ids, so the link can be shared publicly. No login is required.
