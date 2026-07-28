# ⚙ Admin

{% hint style="danger" %}
These commands can only be used by members who have **MANAGE_SERVER** permission
{% endhint %}

### Set Prefix

- **Description**: Set bot prefix
- **Usage**: `!setprefix <newPrefix>`

### Embed

- **Description**: Send an embed message
- **Usage**: `!embed <#channel>`

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

`anti imagespam` runs a quantized SmolVLM model and OCR directly inside the bot
process. The deployment downloads the model into the server cache; no API key
or paid service is required. Enable it with `!anti imagespam on 70`. If model
loading or OCR fails, the message is left untouched.
| **!anti massmention \<on\|off> \[threshold]** | enable or disable massmention detection (default threshold is 3 mentions] |

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

- **Usage**: `!addrr <#channel> <messageId> <role> <emote>`
- **Description**: setup reaction role for the specified message

**Remove Reaction Roles**

- **Usage**: `!removerr <#channel> <messageId>`
- **Description**: remove configured reaction for the specified message

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
- **!ticketcat add \<category> \| \<@roles>**: create a category with optional support roles
- **!ticketcat remove \<category>**: remove a ticket category
- **!ticketcat staff-add \<category> \| \<@role>**: add a support role to an existing category
- **!ticketcat staff-remove \<category> \| \<@role>**: remove a support role from a category

Slash commands use Discord role selectors: `/ticketcat add`, `/ticketcat staff-add`, and `/ticketcat staff-remove`.
Adding or removing category support updates all currently open tickets in that category. A role that is also configured
as global ticket support keeps its access when removed from a single category.
