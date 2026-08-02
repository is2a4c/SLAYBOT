# 🎛 Control Panels

Every system in SLAYBOT is configured the same way: an embed listing each setting
beside the icon of the button that changes it, and rows of those buttons under it.
Nothing has to be typed as command options, and the panel redraws itself after
every change so the current state is always on screen.

A line reads `🔢 **Open ticket limit:** \`10\``, and the settings are grouped
exactly like the buttons below them — the first line belongs to the first button.
Anything off or unset is marked ⚪, so what still needs attention is found without
reading the panel. Long values are shown as a short preview rather than in full.

The buttons carry the same state in their colour:

| Colour | Meaning                                                     |
| ------ | ----------------------------------------------------------- |
| Green  | the setting is on, or the button posts something publicly    |
| Blue   | a channel or role has been chosen                            |
| Grey   | everything still untouched                                   |

## The control hub

```
/panel
```

Opens a private hub with one button per system, split into what the server is
running and what it has left off — the state of every system before anything is
clicked. Clicking a system replaces the hub with that system's panel; the 🏠
button brings the hub back. Everything stays in a single ephemeral message, so a
server never collects leftover setup posts.

Changing a setting requires **Manage Server**. Somebody without it gets the same
command opening the [command panel](#every-command-as-a-panel) instead, which is
the other half of what `/panel` is for.

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
| 📡   | Feeds             | Twitch, YouTube, RSS and GitHub sources, one entry each            |
| 🔢   | Counters          | the voice channels showing the member count                        |
| 📌   | Sticky messages   | the message that keeps itself at the bottom of a channel           |
| 🎭   | Reaction roles    | the messages roles are handed out from                             |

### How the buttons behave

- **Toggles** flip immediately — the panel redraws with the new state, and the
  button turns green.
- **Numbers and text** open a small dialog with the current value already in it
  and an example of what belongs there. Out-of-range numbers are rejected without
  touching what was stored.
- **Channels and roles** open a picker in place of the buttons, already on what is
  stored, with the setting it belongs to underlined in the embed. Pick, and the
  panel comes straight back. Choosing nothing clears the setting.
- **Post the panel** fields place the public message members click — the ticket
  panel, the verify button, the voice controls — replacing the previous one. Those
  public panels are written in the server's language until a server words them
  itself.

### Systems a server has several of

Feeds, counters, sticky messages and reaction roles are not one setting each — a
server has as many as it wants. Those four open on a list instead of a form:

- The list names every entry, says whether it is running, and adds up how many of
  them there are against the limit. **➕ Add** is greyed out once the limit is
  reached, rather than refusing after everything is filled in.
- Picking an entry from the menu opens it with its stored values already in place,
  and every field is the same button-and-dialog as anywhere else. **🗑️ Delete**
  sits on the same row.
- Nothing is written until **✅ Create** or **💾 Save** is pressed: adding a feed
  reaches out to the source first, a sticky message is posted the moment it is
  saved, and reaction roles are placed on the message. Half-finished edits stay in
  the panel where they can be corrected.

What each one does when it is saved:

| System         | On save                                                            | On delete                                      |
| -------------- | ------------------------------------------------------------------ | ---------------------------------------------- |
| Feeds          | checks the source exists and adopts its current item, so setup does not announce a backlog | stops watching it                              |
| Counters       | creates the voice channel, or renames it on the spot                | removes the counter and its channel            |
| Sticky         | posts the message right away; pausing takes the posted copy down    | deletes the posted copy too                    |
| Reaction roles | adds the reactions to the message and drops the ones no longer used | removes the configuration and the bot's reactions |

## Every command as a panel

Settings are only half of what a bot does; the other half is the hundred-odd
commands, none of which anybody remembers. The 📚 button on the hub — and `/panel`
for anybody without Manage Server — opens those as the same kind of screen.

Three steps, in one message:

1. **A section.** Moderation, music, tickets, admin, and so on — only the sections
   holding something this member is allowed to run.
2. **A command.** A menu listing what each one does. A command with subcommands
   asks which one first.
3. **Its form.** Every option the command takes, one line and one button each,
   exactly like a settings panel: text and numbers open a dialog, channels, roles
   and members open a picker, switches flip in place. Options the command cannot
   run without are marked ⚠️ and their buttons are red, and **▶️ Run** stays
   disabled until they are filled in.

Pressing Run hands the form to the command itself, which answers the way it always
does — the panel stays where it is, above the answer.

Nothing about a command is written twice: the form is built from the options the
command already declares for Discord, so a command added tomorrow appears in the
panel with no work. Commands that never got a slash version — reaction roles, the
purge family, the invite tools — get a single box for their arguments, with their
own usage string as the example.

The panel is not a way around anything: the same permission, owner and cooldown
checks run as if the command had been typed, and a command somebody may not run is
not offered to them in the first place.

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
