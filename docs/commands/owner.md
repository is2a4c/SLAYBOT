---
description: Owner-only bot and server management commands
---

# 🔏 Owner

| Command                      | Slash                              | Description                |
| ---------------------------- | ---------------------------------- | -------------------------- |
| **!eval \<script>**          | NA                                 | evaluates something        |
| **!leaveserver \<serverId>** | `/leaveserver server-id:<ID>`      | leave a server             |
| **!listservers \[match]**    | `/listservers [match:<name or ID>]` | lists all/matching servers |

Slash responses are ephemeral. Both commands remain restricted to IDs listed
in `OWNER_IDS`.
