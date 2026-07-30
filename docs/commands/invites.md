---
description: invite tracking and Smart Invites
---

# 📨 Invites

Every invite feature keeps its own prefix command; the slash surface is grouped
under `/invites` so the bot stays within Discord's 100 slash command limit.

| Command                                | Slash                    | Description                                                 |
| -------------------------------------- | ------------------------ | ----------------------------------------------------------- |
| **!invitetracker \<on\|off>**          | **/invites tracker**     | turn invite tracking on or off                              |
| **!invitecodes \[member]**             | **/invites codes**       | list all your invites codes in this guild                   |
| **!inviter \[member]**                 | **/invites inviter**     | shows inviter information                                   |
| **!inviteranks**                       | **/invites ranks**       | view invite ranks configured in the server                  |
| **!inviterank add \<role> \<invites>** | **/invites rank-add**    | add auto-rank after reaching a particular number of invites |
| **!inviterank remove \<role>**         | **/invites rank-remove** | remove invite rank configured with that role                |
| **!invites \[member]**                 | **/invites count**       | view the number of invites of a member                      |
| **!addinvites \<member> \<amount>**    | **/invites add**         | add invites to a member                                     |
| **!resetinvites \<member>**            | **/invites reset**       | clear previously added invites                              |
| **!invitesimport \[member]**           | **/invites import**      | add existing guild invites to users                         |
| —                                      | **/smart-invite**        | create and manage stable public Discord invite pages        |

`tracker`, `rank-add`, `rank-remove`, `add`, `reset` and `import` require the
**Manage Server** permission; the read-only subcommands do not.

`/smart-invite` содержит подкоманды `create`, `list`, `info`, `refresh`,
`set-channel`, `set-description`, `remove-description`, `rename` и `delete`.
Изменения требуют `Manage Server`; выбранный канал должен разрешать боту
`View Channel` и `Create Instant Invite`. Полная эксплуатационная документация:
[Smart Invites](../smart-invites.md).
