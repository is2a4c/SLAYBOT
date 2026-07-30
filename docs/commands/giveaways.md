---
description: 7 commands
---

# 🎉 Giveaways

| Command / Slash                   | Description              |
| --------------------------------- | ------------------------ |
| **!giveaway start \<#channel>**   | setup a new giveaway     |
| **!giveaway pause \<messageId>**  | pause a giveaway         |
| **!giveaway resume \<messageId>** | resume a paused giveaway |
| **!giveaway end \<messageId>**    | end a giveaway           |
| **!giveaway reroll \<messageId>** | reroll a giveaway        |
| **!giveaway list \<messageId>**   | list all giveaways       |
| **!giveaway edit \<messageId>**   | edit a giveaway          |

### Entry requirements

`/giveaway start` takes optional requirements alongside the channel:

| Option            | Effect                                  |
| ----------------- | --------------------------------------- |
| `min_level`       | minimum XP level                        |
| `min_invites`     | minimum effective invites               |
| `min_account_age` | minimum Discord account age in days     |
| `min_server_days` | minimum days on this server             |
| `blocked_role`    | role that may never enter               |
| `bonus_role`      | role that gets extra entries            |
| `bonus_entries`   | entries for that role (2-10, default 2) |

Requirements are printed in the giveaway message so members know why they cannot
enter. Details: [Engagement & Community](../engagement.md#advanced-giveaways).
