# ⚙ Admin

{% hint style="danger" %}
These commands can only be used by members who have **MANAGE_SERVER** permission
{% endhint %}

### Set Prefix

- **Description**: Set bot prefix
- **Usage**: `!setprefix <newPrefix>`

### Embed & branding

- **Description**: send a custom embed, or set how the bot's embeds look on this server
- **Usage**: `!embed <#channel>`, `!embed branding`
- **Slash**: `/embed send channel:`, `/embed branding [name] [color] [footer] [icon] [reset]`

Branding requires **Manage Server** and is documented in
[Engagement & Community](../engagement.md#server-branding).

### Automoderation

{% hint style="info" %}
By default, Auto moderation events are ignored for members who have the following permissions since they are assumed to be channel/server moderators

**KICK_MEMBERS**, **BAN_MEMBERS**, **MANAGE_GUILD**, **MANAGE_MESSAGES**

`!automodconfig debug on` disables this
{% endhint %}

|                                                 |                                                                |
| ----------------------------------------------- | -------------------------------------------------------------- |
| **!automodconfig status**                       | view configuration status                                      |
| **!automodconfig strikes \<amount>**            | set the maximum number of strikes before taking an action      |
| **!automodconfig action \<timeout\|mute\|ban>** | set the action to be performed after receiving maximum strikes |
| **!automodconfig debug \<on\|off>**             | turns on automod for messages sent by admins and moderators    |
| **!automodconfig whitelist**                    | list of channels that are whitelisted                          |
| **!automodconfig whitelistadd \<channel>**      | add a channel to the whitelist                                 |
| **!automodconfig whitelistremove \<channel>**   | remove a channel from the whitelist                            |

**Settings**

| Name                                       | Description                                                                 |
| ------------------------------------------ | --------------------------------------------------------------------------- |
| **!anti ghostping \<on\|off>**             | logs ghost mentions in your server (Requires `/modlog` channel to be setup) |
| **!anti spam \<on\|off>**                  | enable or disable antispam detection                                        |
| **!anti imagespam \<on\|off> [threshold]** | detect suspicious images locally with OCR (recommended threshold: 70)       |
| **!anti strikes-reset \<user>**            | reset all AutoMod strikes for a selected user                               |

`anti imagespam` uses local OCR and sends prepared image regions to the
configured io.net vision model. If no io.net key is configured, the bot can
fall back to the local quantized SmolVLM model. Enable it with
`!anti imagespam on 70`. If OCR or vision analysis fails, the message is left
untouched.
| **!anti massmention \<on\|off> \[threshold]** | enable or disable massmention detection (default threshold is 3 mentions] |

Reset all AutoMod strikes for one user:

```text
!anti strikes-reset @User
/anti strikes-reset user:@User
```

The reset changes only the member's current AutoMod strike counter. Existing
moderation and AutoMod log entries are retained for audit history.

#### Anti-Spam Whitelist

The anti-spam whitelist exempts selected users or roles only from the repeated-message check. Anti Links, Anti Invites, Anti Attachments, Anti Mass Mention, Image Spam, line limits, mention limits, strikes, and all other AutoMod checks continue to apply.

This is useful for notification bots and webhook-backed systems that legitimately send the same text often. Bots are never added automatically. A member with **Manage Server** (`ManageGuild`) permission must add each user or role explicitly.

Prefix commands:

```text
!anti spam-whitelist user add @NotificationBot
!anti spam-whitelist user remove 123456789012345678
!anti spam-whitelist user list
!anti spam-whitelist user clear

!anti spam-whitelist role add @Trusted
!anti spam-whitelist role remove 345678901234567890
!anti spam-whitelist role list
!anti spam-whitelist role clear
```

Slash commands:

```text
/anti spam-whitelist-user action:ADD user:@NotificationBot
/anti spam-whitelist-user action:REMOVE user:@NotificationBot
/anti spam-whitelist-role action:ADD role:@Trusted
/anti spam-whitelist-role action:REMOVE role:@Trusted
/anti spam-whitelist-list
/anti spam-whitelist-clear target:USERS
/anti spam-whitelist-clear target:ROLES
/anti spam-whitelist-clear target:ALL
```

Raw Discord snowflake IDs are accepted by prefix add/remove commands. Unknown IDs remain stored and are shown as `Unknown User` or `Unknown Role`; the bot does not fetch every guild member or remove entries automatically. `@everyone` and managed integration roles cannot be added.

**Autodelete**

| Name                                   | Description                                                                 |
| -------------------------------------- | --------------------------------------------------------------------------- |
| **!autodelete attachments \<on\|off>** | logs ghost mentions in your server (Requires `/modlog` channel to be setup) |
| **!autodelete invites \<on\|off>**     | allow or disallow sending discord invites in message                        |
| **!automod links \<on\|off>**          | allow or disallow sending links in message                                  |
| **!automod maxlines \<amount>**        | sets maximum lines allowed per message                                      |

{% hint style="warning" %}
Each time a member tries to break the automated rule, he/she **receives a strike**. After receiving the maximum number of strikes (default 10), the moderation action (default TIMEOUT) is performed on them
{% endhint %}

### Channels Counters

- **Description:** setup counter channel in the guild
- **Usage**: `!counter <counter_type> <name>`
- **Available counters** **types**
  - USERS: counts the total server member count (members + bots)
  - MEMBERS: counts the total member count
  - BOTS: counts the total number of bots

### Warnings

- **!maxwarn limit \<amount>**: set max warnings a member can receive before taking an action
- **!maxwarn action \<timeout\|kick\|ban>**: set the action to be performed after receiving maximum warnings

### Moderation Logging

- **Description**: enable or disable moderation logs
- **Usage**: `!modlog <channel|off>`

{% hint style="info" %}
Moderation logging enable logging of all **moderation actions** and **automod events**
{% endhint %}

### Flag Translations

_Enabling this feature will allow members to simply react to any message with a country flag emoji, translating that message content to regional language_

- **Description**: configure flag translation in the server
- **Usage**: `!flagtr <on|off>`

![](../.gitbook/assets/ss_translation.png)

### Auto Role

- **Description**: setup role to be given when a member joins the server
- **Usage**: `!autorole <role|off>`

### Greeting

{% tabs %}
{% tab title="Welcome" %}
**!welcome status \<on\|off>**

- enable or disable welcome message

**!welcome channel \<#channel>**

- configure channel where welcome messages must be sent

**!welcome preview**

- send a welcome preview

**!welcome desc \<content>**

- set welcome embed description

**!welcome footer \<content>**

- set welcome embed footer

**!welcome thumbnail \<on\|off>**

- enable or disable welcome message thumbnail

**!welcome color \<#hex>**

- set welcome embed color

**!welcome image \<image-url>**

- set welcome embed image
  {% endtab %}

{% tab title="Farewell" %}
**!farewell status \<on\|off>**

- enable or disable farewell message

**!farewell channel \<#channel>**

- configure channel where farewell messages must be sent

**!farewell preview**

- send a farewell preview

**!farewell desc \<content>**

- set farewell embed description

**!farewell footer \<content>**

- set farewell embed footer

**!farewell thumbnail \<on\|off>**

- enable or disable farewell message thumbnail

**!farewell color \<#hex>**

- set farewell embed color

**!farewell image \<#image-url>**

- set farewell embed image
  {% endtab %}
  {% endtabs %}

{% hint style="success" %}

#### Allowed Content Replacements

- \n : New Line&#x20;
- {server} : Server Name&#x20;
- {count} : Server member count&#x20;
- {member:nick} : Member Nickname&#x20;
- {member:name} : Member Name&#x20;
- {member:dis} : Member Discriminator&#x20;
- {member:tag} : Member Tag&#x20;
- {member:mention} : Member Mention&#x20;
- {member:avatar} : Member Avatar URL&#x20;
- {inviter:name} : Inviter Name&#x20;
- {inviter:tag} : Inviter Tag&#x20;
- {invites} : Inviter Invites
  {% endhint %}

### Reaction Roles

**Create Reaction Role**

- **Usage**: `!addrr <#channel> <messageId> <emote> <role>`
- **Description**: setup reaction role for the specified message

**Configure Multiple Reaction Roles**

- **Usage**: `!setrr <#channel> <messageId> <emoji @role, emoji @role ...>`
- **Slash command**: `/setrr channel:#channel message_id:123 pairs:😀 @Member, 🎮 @Gamer`
- **Description**: validates and replaces all reaction roles for a message in one command (maximum 20)

**Remove Reaction Roles**

- **Usage**: `!removerr <#channel> <messageId>`
- **Description**: remove configured reaction for the specified message

### Role Automation

Everything that hands out roles automatically lives under `/roles`.

**Self role panels** — buttons or a dropdown members click themselves.

| Command                                                     | Description                                            |
| ----------------------------------------------------------- | ------------------------------------------------------ |
| **/roles self create name: channel: style:**                | post a new panel (`style` is `buttons` or `dropdown`)  |
| **/roles self add panel: role: label: emoji: description:** | add a role to the panel (up to 25)                     |
| **/roles self remove panel: role:**                         | take a role off the panel                              |
| **/roles self config panel: ...**                           | limits, unique mode, required role, title, description |
| **/roles self list** / **!roles self list**                 | list every panel of the server                         |
| **/roles self delete panel:**                               | delete the panel and its message                       |

`config` options: `max_roles` (0 = no limit), `unique` (one role at a time, for
colour roles), `allow_remove` (set to false for an opt-in-only panel),
`required_role` (gate the panel behind a role), plus `title`, `description` and
`placeholder`. Panels are referenced by their name or by their message id.

**Temporary roles** — roles that expire on their own. The deadline is stored in
the database, so a restart or downtime does not lose it.

| Command                                           | Description                           |
| ------------------------------------------------- | ------------------------------------- |
| **/roles temp add user: role: duration: reason:** | grant a role for `2h`, `30m`, `7d`, … |
| **/roles temp remove user: role:**                | remove it immediately                 |
| **/roles temp list [user:]**                      | list the roles that have not expired  |

Granting the same role again reschedules the existing expiry instead of stacking
a second one. Durations run from 10 seconds to one year.

**Voice roles** — a role while the member sits in a voice channel.

| Command                               | Description                                 |
| ------------------------------------- | ------------------------------------------- |
| **/roles voice set role: [channel:]** | leave `channel` empty for any voice channel |
| **/roles voice unset [channel:]**     | stop handing the role out                   |
| **/roles voice list**                 | show the configuration                      |

**Role restore** — give roles back when a member rejoins.

| Command                                                               | Description                           |
| --------------------------------------------------------------------- | ------------------------------------- |
| **/roles restore config status: retention_days: include_privileged:** | turn it on or off and tune it         |
| **/roles restore status**                                             | show the current configuration        |
| **/roles restore check user:**                                        | show the snapshot stored for a member |
| **/roles restore purge**                                              | delete every snapshot of this server  |

Snapshots are taken when a member leaves and kept for `retention_days` (90 by
default, maximum 365). Roles carrying moderation permissions are **not** restored
unless `include_privileged` is set, and roles above the bot are always skipped.

### Starboard, sticky messages, verification, modmail, feeds, events, backups, webhooks

These live under their own commands and are documented in
[Engagement & Community](../engagement.md): `/starboard`, `/sticky`,
`/verification`, `/modmail`, `/feeds`, `/event`, `/backup`, `/webhook`.

### Ticketing

**Configuration**

- **!ticket setup \<#channel>**: setup a new ticket message
- **!ticket log \<#channel>**: setup log channel for tickets
- **!ticket limit \<amount>**: set maximum number of concurrent open tickets
- **!ticket closeall**: close all open tickets
- **!ticket staff-add \<@role>**: allow a role to view, reply to, and manage all tickets
- **!ticket staff-remove \<@role>**: remove a role from global ticket support
- **!ticket staff-list**: list global ticket support roles

The same controls are available as `/ticket staff-add`, `/ticket staff-remove`, and `/ticket staff-list`.
Adding a support role updates existing open tickets as well as new tickets. Support roles can reply in ticket channels,
close tickets, and use the participant add/remove commands. Ticket setup, limits, logs, support-role configuration, and
mass closing still require the **Manage Server** permission.

**Ticket Channel Commands**

- **!ticket close**: close the ticket
- **!ticket add \<userId\|roleId>**: add user/role to the ticket
- **!ticket remove \<userId\|roleId>**: remove user/role from the ticket

**Ticket Category Commands**

- **!ticketcat list**: list all ticket categories
- **!ticketcat add \<category> \| \<@roles> \| \<#notification-channel>**: create a category with optional support roles and notification channel
- **!ticketcat remove \<category>**: remove a ticket category
- **!ticketcat staff-add \<category> \| \<@role>**: add a support role to an existing category
- **!ticketcat staff-remove \<category> \| \<@role>**: remove a support role from a category
- **!ticketcat notify-set \<category> \| \<#channel>**: set where new-ticket notifications are sent for a category
- **!ticketcat notify-clear \<category>**: disable new-ticket notifications for a category

Slash commands use Discord role and channel selectors: `/ticketcat add`, `/ticketcat staff-add`,
`/ticketcat staff-remove`, `/ticketcat notify-set`, and `/ticketcat notify-clear`.
Adding or removing category support updates all currently open tickets in that category. A role that is also configured
as global ticket support keeps its access when removed from a single category. Category notifications include a link to
the new ticket and mention that category's support roles together with global ticket support roles.
