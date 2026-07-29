---
description: Owner-only bot and server management commands
---

# 🔏 Owner

| Command                                                  | Slash                               | Description                  |
| -------------------------------------------------------- | ----------------------------------- | ---------------------------- |
| **!eval \<script>**                                      | NA                                  | evaluates something          |
| **!leaveserver \<serverId>**                             | `/leaveserver server-id:<ID>`       | leave a server               |
| **!listservers \[match]**                                | `/listservers [match:<name or ID>]` | lists all/matching servers   |
| **!blockserver block \<serverId> \[duration] \[reason]** | `/blockserver block`                | block a server and leave it  |
| **!blockserver unblock \<serverId>**                     | `/blockserver unblock`              | remove a server block        |
| **!blockserver list**                                    | `/blockserver list`                 | list active server blocks    |
| **!blockserver status \<serverId>**                      | `/blockserver status`               | show a server's block status |

Slash responses are ephemeral. These commands remain restricted to IDs listed
in `OWNER_IDS`.
