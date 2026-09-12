---
title: "Campfires"
description: "Campfire fuels, lifetimes, build XP, and cooking compatibility from the live content tables."
---

Building a fire consumes one log when the three-second build completes. A successful new fire replaces the old one. Log tier changes lifetime and build XP only.

## Fuels

<div class="codex-grid codex-grid--compact">
<div class="codex-card is-linked"><span class="codex-card__media"><img class="codex-icon" src="../assets/items/thumb/palewood_log.webp" alt="Pine Log" width="128" height="128" loading="lazy" decoding="async" /></span><span class="codex-card__text"><span class="codex-card__eyebrow">Level 1</span><span class="codex-card__title"><a class="codex-card__link" href="../items/palewood_log/">Pine Log</a></span><span class="codex-card__meta">Burns for 72 s</span><dl class="codex-facts"><div><dt>Build time</dt><dd>3.0 s</dd></div><div><dt>Fletching XP</dt><dd>2</dd></div><div><dt>Crafting XP</dt><dd>2</dd></div></dl></span></div>
<div class="codex-card is-linked"><span class="codex-card__media"><img class="codex-icon" src="../assets/items/thumb/duskoak_log.webp" alt="Ash Log" width="128" height="128" loading="lazy" decoding="async" /></span><span class="codex-card__text"><span class="codex-card__eyebrow">Level 5</span><span class="codex-card__title"><a class="codex-card__link" href="../items/duskoak_log/">Ash Log</a></span><span class="codex-card__meta">Burns for 120 s</span><dl class="codex-facts"><div><dt>Build time</dt><dd>3.0 s</dd></div><div><dt>Fletching XP</dt><dd>5</dd></div><div><dt>Crafting XP</dt><dd>5</dd></div></dl></span></div>
<div class="codex-card is-linked"><span class="codex-card__media"><img class="codex-icon" src="../assets/items/thumb/cairnpine_log.webp" alt="Oak Log" width="128" height="128" loading="lazy" decoding="async" /></span><span class="codex-card__text"><span class="codex-card__eyebrow">Level 10</span><span class="codex-card__title"><a class="codex-card__link" href="../items/cairnpine_log/">Oak Log</a></span><span class="codex-card__meta">Burns for 180 s</span><dl class="codex-facts"><div><dt>Build time</dt><dd>3.0 s</dd></div><div><dt>Fletching XP</dt><dd>7</dd></div><div><dt>Crafting XP</dt><dd>7</dd></div></dl></span></div>
<div class="codex-card is-linked"><span class="codex-card__media"><img class="codex-icon" src="../assets/items/thumb/cinderpine_log.webp" alt="Walnut Log" width="128" height="128" loading="lazy" decoding="async" /></span><span class="codex-card__text"><span class="codex-card__eyebrow">Level 20</span><span class="codex-card__title"><a class="codex-card__link" href="../items/cinderpine_log/">Walnut Log</a></span><span class="codex-card__meta">Burns for 300 s</span><dl class="codex-facts"><div><dt>Build time</dt><dd>3.0 s</dd></div><div><dt>Fletching XP</dt><dd>10</dd></div><div><dt>Crafting XP</dt><dd>10</dd></div></dl></span></div>
</div>

Lifetime follows `60 + 12 × tier` seconds. Each skill receives `round(gatherXp(tier) × 0.2)` XP.

## Cooking on a fire

All 4 fish recipes accept both Range and Campfire. If a fire expires during a batch, completed food stays in the inventory and the next fish is not consumed.

<details class="codex-details">
<summary>Log meshes used by the placed fire</summary>

| Log | Log asset |
| --- | --- |
| Pine Log | nature_wood_log |
| Ash Log | nature_wood_log_moss |
| Oak Log | nature_wood_log_snow |
| Walnut Log | nature_wood_log |

</details>
