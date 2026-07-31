# 🎛 Control Panels

Every system in SLAYBOT is configured the same way: an embed that names what each
icon does, and rows of icon buttons under it. Nothing has to be typed as command
options, and the panel redraws itself after every change so the current state is
always on screen.

## The control hub

```
/panel
```

Opens a private hub with one button per system. Clicking a system replaces the
hub with that system's panel; the 🏠 button brings the hub back. Everything stays
in a single ephemeral message, so a server never collects leftover setup posts.

Requires **Manage Server** — both to open the panel and to press anything in it.

Systems available from the hub:

| Icon | System            | What it covers                                                    |
| ---- | ----------------- | ----------------------------------------------------------------- |
| 🛠️   | Server            | prefix, moderation log, autoroles, levelling, invite tracking      |
| 🎙️   | Temporary voice   | join-to-create channel, naming, default limit, claiming            |
| 🎫   | Tickets           | log channel, open limit, support roles, the "open a ticket" panel  |
| 🛡️   | Verification      | button or captcha, roles handed out, the verify panel              |
| 👋   | Welcome           | greeting message and embed                                         |
| 🚪   | Farewell          | goodbye message and embed                                          |
| 🤖   | Automod           | what is caught in messages and what happens to the sender          |
| ⭐   | Starboard         | channel, emoji, threshold                                          |
| 📝   | Suggestions       | suggestion channels and who approves                               |
| 📬   | Modmail           | thread channel, support roles, anonymity                           |
| 🎂   | Birthdays         | announcement channel, message, birthday role                       |
| ✨   | AI                | AI moderation, ticket summaries, knowledge base                    |

### How the buttons behave

- **Toggles** flip immediately — the panel redraws with the new state.
- **Numbers and text** open a small dialog with the current value already in it.
  Out-of-range numbers are rejected without touching what was stored.
- **Channels and roles** open a picker in place of the buttons. Pick, and the
  panel comes straight back. Choosing nothing in a multi-select clears the list.
- **Post the panel** fields place the public message members click — the ticket
  panel, the verify button, the voice controls — replacing the previous one.

## Temporary voice channels

Members who join the configured join-to-create channel get a voice channel of
their own, and control it from a panel of fifteen icons:

|                   |                                                             |
| ----------------- | ----------------------------------------------------------- |
| ✏️ Name           | rename the channel                                          |
| 🔢 Limit          | member limit, 0 for none                                    |
| 🔒 Access         | lock the channel to trusted members                         |
| 👁️ Lobby          | hide the channel from the channel list                      |
| 💬 Chat           | close the channel chat to people outside it                 |
| 🤝 Trust          | let somebody in while the channel is locked                 |
| 🚷 Untrust        | take that access away                                       |
| 📨 Invite         | send somebody a one-hour invite by direct message           |
| 👢 Kick           | disconnect somebody                                         |
| 🌍 Region         | pin the voice server region                                 |
| 🔨 Ban            | keep somebody out for good                                  |
| 🕊️ Unban          | let them back                                               |
| 👑 Claim          | take over a channel whose owner left                        |
| 🔑 Transfer       | hand the channel to somebody else                           |
| 🗑️ Delete         | delete the channel                                          |

Only the owner drives the buttons; the one exception is 👑 Claim, which anybody
still in the channel may press once the owner has left. Empty channels are
deleted on their own, including after a restart.

```
/tempvoice setup panel_channel:#voice-control
/vc
```

`/tempvoice setup` turns the system on and posts the panel, creating the
join-to-create channel if none is given. `/vc` opens a private copy of the panel
for anybody who does not want to scroll back to it.

## Colours and images

Fields the bot has to hand to Discord are checked before they are stored: a
colour must be hex (`#A855F7`, or `a855f7` — the hash is filled in), an image
must be an `https` link. Discord throws on anything else, which would break the
message at send time rather than at setup.

Servers configured before this check existed may still hold an unusable value.
The bot clears those on startup, setting them back to the default, and logs what
it changed. To run it against a database without starting the bot:

```bash
npm run db:fix-appearance -- --dry-run
```

Drop `--dry-run` to apply it. It is safe to run repeatedly — a second pass finds
nothing to do.

## Image checks

Reading text out of an image and judging whether it is a scam both go to an
OpenAI-compatible endpoint. Which one is a matter of configuration:

| Provider | Key | Free? |
| --- | --- | --- |
| Google Gemini | `GEMINI_API_KEY` | yes, but only from supported countries |
| Cloudflare Workers AI | `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` | yes, 10k neurons/day |
| Mistral | `MISTRAL_API_KEY` | yes, Experiment tier, Pixtral reads images |
| OpenRouter | `OPENROUTER_API_KEY` | free models, 50 requests/day until topped up |
| io.net | `IO_INTELLIGENCE_API_KEY` | no, paid per token |

Gemini checks where the request comes from, not just the key: from an
unsupported country it answers `User location is not supported for the API use`.
`IMAGE_AI_PROXY` routes provider calls through somewhere it accepts.

Set one key and that provider is used. `IMAGE_AI_PROVIDER`, `IMAGE_AI_BASE_URL`,
`IMAGE_AI_MODEL` and `IMAGE_AI_API_KEY` override the choice or point at any
other endpoint speaking the same dialect.

With no key at all the bot uses a local model on its own CPU: free, private, and
slower. It runs in a worker thread, so an image never blocks the bot. If the
configured provider starts failing — out of credits, rate limited, unreachable —
checks fall back to that local model, and three failures in a row park the
provider for ten minutes.

Free tiers usually allow the provider to train on what is sent, and what is sent
here is members' images. Bear that in mind when picking one.

## Language

```
/language
```

Picks the language the bot speaks on this server: Russian, English, or **Auto**,
which follows the server's own Discord locale. Panels, prompts and results all
follow the choice; private replies follow the reader's client language until a
server pins a language explicitly.
