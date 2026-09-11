---
title: "Campfires"
description: "Campfire fuels, lifetimes, build XP, and cooking compatibility from the live content tables."
---

Building a fire consumes one log when the three-second build completes. A successful new fire replaces the old one. Log tier changes lifetime and build XP only.

| Level | Log | Build time | Lifetime | Fletching XP | Crafting XP | Log asset |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | [Pine Log](../items/palewood_log/) | 3.0 s | 72 s | 2 | 2 | nature_wood_log |
| 5 | [Ash Log](../items/duskoak_log/) | 3.0 s | 120 s | 5 | 5 | nature_wood_log_moss |
| 10 | [Oak Log](../items/cairnpine_log/) | 3.0 s | 180 s | 7 | 7 | nature_wood_log_snow |
| 20 | [Walnut Log](../items/cinderpine_log/) | 3.0 s | 300 s | 10 | 10 | nature_wood_log |

Lifetime follows `60 + 12 × tier` seconds. Each skill receives `round(gatherXp(tier) × 0.2)` XP.

All 4 fish recipes accept both Range and Campfire. If a fire expires during a batch, completed food stays in the inventory and the next fish is not consumed.
