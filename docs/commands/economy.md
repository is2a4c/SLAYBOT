---
description: 12 command actions
---

# 🪙 Economy

| Command                                | Slash              | Description                           |
| -------------------------------------- | ------------------ | ------------------------------------- |
| **!bank balance**                      | **/bank balance**  | check your coin balance               |
| **!bank deposit \<amount>**            | **/bank deposit**  | deposit coins to your bank account    |
| **!bank withdraw \<amount>**           | **/bank withdraw** | withdraw coins from your bank account |
| **!bank transfer \<member> \<amount>** | **/bank transfer** | transfer coins to other user          |
| **!beg**                               | **/beg**           | beg from someone                      |
| **!daily**                             | **/daily**         | receive a daily bonus                 |
| **!gamble \<amount>**                  | **/gamble**        | try your luck by gambling             |
| **!global profile [member]**           | **/global profile** | view a cross-server profile and shared balance |
| **!global leaderboard \<type>**        | **/global leaderboard** | compare players, servers, or global wealth |
| **!global season**                     | **/global season** | view the current monthly UTC competition |
| **!global rewards**                    | **/global rewards** | preview the previous season prize |
| **!global claim**                      | **/global claim** | claim the previous season prize once |

The economy wallet belongs to the Discord user, so the same `coins` and `bank`
balance is available on every server using this Slaybot installation. The global
season runs for one UTC calendar month. Genuine messages that pass AutoMod and
the existing XP cooldown add the earned XP to both the player score and the
server score. Commands, removed messages, and cooldown spam do not count.

## Season stakes

The previous completed season pays directly into the same global bank used by
`/bank`:

| Goal | Reward |
| --- | ---: |
| Global #1 | 25,000 🪙 + permanent Global Champion title |
| Global #2 | 15,000 🪙 + permanent Global Podium title |
| Global #3 | 10,000 🪙 + permanent Global Podium title |
| Global #4–10 | 5,000 🪙 + permanent Global Top 10 title |
| 500 / 2,000 / 7,500 points | 500 / 2,000 / 7,500 🪙 + tier title |
| Champion-server contributor with 100+ points | 5,000 🪙 + permanent Server Champion title |

Rank, milestone, and server rewards stack. A player can earn at most 37,500 🪙
in one season. `/global rewards` previews the finished season; `/global claim`
credits it exactly once.
