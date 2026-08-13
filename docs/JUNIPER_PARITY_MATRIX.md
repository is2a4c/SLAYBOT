# JuniperBot dashboard parity matrix

This document records the functional surface inspected in the authenticated
JuniperBot dashboard on 2026-08-14. It is a behaviour inventory, not a request
to copy Juniper's branding, text, artwork, or visual layout. SLAYBOT keeps its
own information architecture and design language.

## Common settings

- Command prefix, dashboard language, command language, timezone, and the
  default colour used by system messages.
- Independent switches for custom slash/context commands and legacy text
  commands.
- Trusted administrator roles, starter roles, always-assign-on-rejoin, nickname
  restoration, role restoration, and explicit restorable/excluded role lists.
- Success and error message deletion delays, DM delivery for help, Discord reply
  mode, and optional participant mentions in replies.
- Temporary voice roles as repeatable channel-to-role mappings (voice and stage
  channels are supported).

## Moderation and automod

- Moderator roles, administrator/moderator cooldown exemption, role hierarchy
  enforcement, optional default warning lifetime, and the default mute scope.
- Timeout, mute role, or both; optional reaction blocking; managed mute-role
  permission propagation and excluded channels.
- Nine independently configurable filters: links, Discord invites,
  scam/phishing, forbidden words, repeated text, caps, emoji, mentions, and
  Zalgo.
- Shared filter controls: delete message, punishment, notification template,
  moderator bypass, slash-argument bypass, included/excluded roles, and
  included/excluded channels/categories.
- Link allow/deny mode with wildcard masks; invite allow-list; forbidden-word
  whole-word/case rules; repeated-message threshold; caps minimum letters and
  percentage; emoji limit; separate public/role/channel/member mention limits;
  Zalgo percentage threshold.
- Escalation rules triggered at a warning count. Each rule has a colour and can
  kick, mute, ban, or add/remove roles. The final-level policy controls warning
  reset behaviour.

## Music

- Dedicated music channel or use anywhere, DJ roles, and a default search
  provider.
- Compact queue, separate added/played/skipped notice cleanup, playback
  progress, per-user queue limit, and track-duration limit.
- Autoplay on voice join using a track/query and a selected output text channel.
- Premium-only playback limits are represented as capability-gated settings.

## Audit

- Server audit and dashboard audit are separate surfaces.
- Server audit has ignored text channels/categories and 25 Discord webhook
  destinations, selectable independently per event.
- Event groups: moderation (8), members (4), messages (3), voice (3), stage (5),
  and bot lifecycle (2).
- The searchable timeline filters by event type, channel, and member. Retained
  dashboard history is capability-gated.

## Publications and subscriptions

- Provider flows for VK, Twitch, YouTube, and Trovo.
- Twitch/YouTube/Trovo accept a channel name or URL and continue through channel
  discovery before message configuration.
- VK supports OAuth and a manual Callback API setup using community name and
  confirmation code, including wall-post callbacks.
- A subscription selects its destination, message template, and provider
  variables. VK additionally supports keywords and attachment-type filters.

## Ranking

- Global enable, public leaderboard, reset-on-leave, ignored roles/channels,
  text XP multiplier, XP overrides, and a level-up message template.
- Voice XP enable, ignored roles/channels, multiplier, and a maximum active-user
  limit.
- Level rewards and voice-time rewards independently add and remove role sets.
  Voice thresholds are expressed in days, hours, and minutes.
- Rank-card accent/background customisation is capability-gated.
- Member search/list/pagination can filter leaderboard modes, reset a member,
  or edit level, internal currency, and voice time.

## Notifications

- Server welcome, DM welcome, leave, boost, and system DMs for ban, kick, mute,
  and warnings.
- Server events use a destination channel plus the shared rich-message editor;
  DM welcome uses the editor without a channel.
- Rich messages support text/panel/components modes, preview, variables,
  fields/components, mention control, default fallback, TTS, and deletion delay.
- Moderation DMs use a safe additional-information field; template execution is
  intentionally unavailable there.

## Commands and templates

- 55 built-in commands grouped as information (6), moderation (14), ranking
  (4), music (17), fun (6), and utilities (8). Commands and whole groups can be
  enabled/disabled.
- Built-in command policy: NSFW, hidden, delete invocation, cooldown scope,
  allowed/ignored roles, and allowed/ignored channels/categories.
- Custom command metadata adds name, description, group, message/member context
  menus, and slash-command publication.
- A command contains one or more named actions. Action types are send message,
  modal dialog, change roles, run built-in command, and execute template code.
- Message actions add channel, text/panel/components, polls, mention control,
  ephemeral/deferred/update modes, TTS, deletion delay, preview, and an optional
  permission override.
- Modal actions define title, input/file components, and the confirmation
  action. Role actions can target the invoking or mentioned member.
- Slash commands have either root parameters or subcommands. Parameters define
  name, description, Discord type, choices, and required state.
- Global reusable templates are capability-gated and callable from other
  templates.

## Reminders

- Search/filter, one-time and repeating schedules, timezone-aware date/time,
  destination channel, and description.
- Uses the shared rich-message editor with poll, mention control, TTS,
  announcement publishing, deletion delay, preview, and save/save-close flows.

## Fun

- Roulette enable switch.
- Forest Fuss enable, category, concurrent sessions, maximum players, lobby and
  wolf-channel names, leader-only stop/skip, and recruitment/intro/day/wolves/
  character/result timers.

## SLAYBOT implementation boundaries

- Existing SLAYBOT automod, music, feeds, reminders, audit, moderation, and
  ranking services remain the source of truth where they already implement a
  feature.
- The first Control Center slice exposes live settings already backed by those
  services. Audited settings that still need runtime work are visible only as
  disabled roadmap controls marked `Coming soon` / `Скоро`.
- New dashboard-only settings must not pretend to be active. Every control is
  either wired to runtime behaviour, labelled as a capability-gated preview, or
  omitted until its service exists.
- Destructive operations (global/member resets, deleting rewards/actions, and
  subscription removal) require a confirmation step and a specific permission.

## Implemented live in this iteration

- Authenticated dashboard management for Twitch, YouTube, RSS, and GitHub
  subscriptions, including source validation, safe first-run adoption,
  pause/resume, deletion, and dashboard audit entries.
- Server reminder management backed by the existing scheduler: browser-local
  date/time conversion, one-time or repeating delivery, card title/colour/footer,
  explicit mention policy, TTS, deletion delay, listing, and scoped deletion.
- Level and voice-time role rewards. Runtime handlers apply every threshold
  crossed, remove roles before adding roles, ignore unmanageable roles, and keep
  XP/voice tracking alive if Discord rejects a role change.
- Ranking member editor for level, residual XP, and cumulative voice minutes,
  with guild membership validation and immutable dashboard audit history.
