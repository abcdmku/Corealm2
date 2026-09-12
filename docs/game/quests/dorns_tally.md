---
title: "Dorn's Tally"
description: "Dorn's Tally start location, requirements, walkthrough, and rewards."
---

The Trade Company ledger says a Copper seam is worth four loads. Pitmaster Dorn has been signing that figure for nine years and has never once believed it. Work a seam to the bottom, count what it actually gave, and settle the argument with a number.

<img class="codex-shot" src="../../assets/captures/npcs/npc_pitmaster_dorn.webp" alt="Pitmaster Dorn in the running Corealm world" width="960" height="540" loading="lazy" decoding="async" />

| Giver | Start location | Region | Requirements | Prerequisite |
| --- | --- | --- | --- | --- |
| [Pitmaster Dorn](../../npcs/#pitmaster-dorn) | [Millfield Square](../../regions/#millfield-square) | [Farmland](../../regions/#farmland) | None | None |



## Walkthrough

### 1. Work one Copper seam at the Copper Pit until it is worked out. Stay on the same seam: Dorn wants the count from one node, not from six.

Pick one seam and stay on it. `inspect` the node while you work: its `resource.remaining` counts down, and the event that ends it carries `yieldsTaken`, which is the number Dorn wants.

<nav class="corealm-quest-where" aria-label="Locations for step 1"><span>Where</span><a href="../../regions/#copper-pit">Copper Pit</a></nav>
<nav class="corealm-quest-items" aria-label="Items for step 1"><span>Items</span><a href="../../items/grithe_ore/">Copper Ore</a></nav>
<div class="corealm-quest-step-evidence">
<div class="corealm-quest-scenes"><figure class="corealm-quest-scene"><img class="codex-card__shot" src="../../assets/captures/thumbs/locations/bracken_pit.webp" alt="Copper Pit in the running Corealm world" width="480" height="270" loading="lazy" decoding="async" /><figcaption><strong>Copper Pit</strong><span>Copper Pit, Farmland</span></figcaption></figure></div>
<figure class="corealm-location-map corealm-quest-map" data-location-map
 data-map-focus="36.667,67.879,36.667,67.879"
 style="--map-image-ratio:0.72727">
<div class="corealm-map-viewport" data-map-viewport role="region" tabindex="0" aria-label="Map for Dorn's Tally, step 1">
<div class="corealm-map-stage" data-map-stage>
<img src="../../assets/world-map.webp" alt="Overhead map rendered from the Corealm game world" draggable="false" />
<a class="corealm-map-marker" href="../../regions/#copper-pit" style="--map-x:36.6667%;--map-y:67.8788%" data-map-side="right" data-map-kind="seam" data-map-marker aria-label="Copper Pit, Farmland" title="Copper Pit, Farmland"><span>Copper Pit<small>Farmland</small></span></a>
</div>
<span class="corealm-map-north" aria-hidden="true">N</span>
<div class="corealm-map-controls corealm-map-controls-zoom" aria-label="Map zoom controls">
<button type="button" data-map-action="out" aria-label="Zoom out" title="Zoom out">&minus;</button>
<button type="button" data-map-action="reset" aria-label="Reset map" title="Reset map">&#x25CE;</button>
<button type="button" data-map-action="in" aria-label="Zoom in" title="Zoom in">+</button>
</div>
<button class="corealm-map-expand" type="button" data-map-action="expand" aria-label="Expand map" aria-pressed="false" title="Expand map">&#x26F6;</button>
</div>
<figcaption>Copper Pit.</figcaption>
</figure>
</div>

#### Stage reward

| Reward | Amount |
| --- | --- |
| Mining XP | 40 |

### 2. Tell Pitmaster Dorn how many loads the seam actually gave. He offers three bands; pick the one your seam fell into.

The exact figure was in the `resource.depleted` event, and the quest kept it: it is the `last_seam_yield` counter on this quest's record. Guess wrong and Dorn sends you back to check, which costs nothing but a walk.

<nav class="corealm-quest-where" aria-label="Locations for step 2"><span>Where</span><a href="../../regions/#millfield-square">Millfield Square</a></nav>
<div class="corealm-quest-step-evidence">
<div class="corealm-quest-scenes"><figure class="corealm-quest-scene"><img class="codex-card__shot" src="../../assets/captures/thumbs/npcs/npc_pitmaster_dorn.webp" alt="Pitmaster Dorn in the running Corealm world" width="480" height="270" loading="lazy" decoding="async" /><figcaption><strong>Pitmaster Dorn</strong><span>Millfield Bank, Farmland</span></figcaption></figure></div>
<figure class="corealm-location-map corealm-quest-map" data-location-map
 data-map-focus="36.483,78.091,36.483,78.091"
 style="--map-image-ratio:0.72727">
<div class="corealm-map-viewport" data-map-viewport role="region" tabindex="0" aria-label="Map for Dorn's Tally, step 2">
<div class="corealm-map-stage" data-map-stage>
<img src="../../assets/world-map.webp" alt="Overhead map rendered from the Corealm game world" draggable="false" />
<a class="corealm-map-marker" href="../../npcs/#pitmaster-dorn" style="--map-x:36.4833%;--map-y:78.0909%" data-map-side="right" data-map-kind="npc" data-map-marker aria-label="Pitmaster Dorn, Farmland" title="Pitmaster Dorn, Farmland"><span>Pitmaster Dorn<small>Farmland</small></span></a>
</div>
<span class="corealm-map-north" aria-hidden="true">N</span>
<div class="corealm-map-controls corealm-map-controls-zoom" aria-label="Map zoom controls">
<button type="button" data-map-action="out" aria-label="Zoom out" title="Zoom out">&minus;</button>
<button type="button" data-map-action="reset" aria-label="Reset map" title="Reset map">&#x25CE;</button>
<button type="button" data-map-action="in" aria-label="Zoom in" title="Zoom in">+</button>
</div>
<button class="corealm-map-expand" type="button" data-map-action="expand" aria-label="Expand map" aria-pressed="false" title="Expand map">&#x26F6;</button>
</div>
<figcaption>Millfield Square.</figcaption>
</figure>
</div>

#### Stage reward

| Reward | Amount |
| --- | --- |
| Mining XP | 60 |

### 3. Make the vault agree with the ledger: bank 15 Copper ore at the Millfield Bank.

Walk to the bank counter and `bank("deposit", { itemId: "grithe_ore", quantity: -1 })`. The stage counts what is in the bank, not what you carried in.

<nav class="corealm-quest-where" aria-label="Locations for step 3"><span>Where</span><a href="../../regions/#millfield-bank">Millfield Bank</a></nav>
<nav class="corealm-quest-items" aria-label="Items for step 3"><span>Items</span><a href="../../items/grithe_ore/">Copper Ore</a></nav>
<div class="corealm-quest-step-evidence">
<div class="corealm-quest-scenes"><figure class="corealm-quest-scene"><img class="codex-card__shot" src="../../assets/captures/thumbs/entities/coldbrace_bank.webp" alt="Millfield Bank in the running Corealm world" width="480" height="270" loading="lazy" decoding="async" /><figcaption><strong>Millfield Bank</strong><span>Millfield Bank, Farmland</span></figcaption></figure></div>
<figure class="corealm-location-map corealm-quest-map" data-location-map
 data-map-focus="36.354,78.206,36.354,78.206"
 style="--map-image-ratio:0.72727">
<div class="corealm-map-viewport" data-map-viewport role="region" tabindex="0" aria-label="Map for Dorn's Tally, step 3">
<div class="corealm-map-stage" data-map-stage>
<img src="../../assets/world-map.webp" alt="Overhead map rendered from the Corealm game world" draggable="false" />
<a class="corealm-map-marker" href="../../regions/#millfield-bank" style="--map-x:36.3542%;--map-y:78.2061%" data-map-side="right" data-map-kind="entity" data-map-marker aria-label="Millfield Bank, Farmland" title="Millfield Bank, Farmland"><span>Millfield Bank<small>Farmland</small></span></a>
</div>
<span class="corealm-map-north" aria-hidden="true">N</span>
<div class="corealm-map-controls corealm-map-controls-zoom" aria-label="Map zoom controls">
<button type="button" data-map-action="out" aria-label="Zoom out" title="Zoom out">&minus;</button>
<button type="button" data-map-action="reset" aria-label="Reset map" title="Reset map">&#x25CE;</button>
<button type="button" data-map-action="in" aria-label="Zoom in" title="Zoom in">+</button>
</div>
<button class="corealm-map-expand" type="button" data-map-action="expand" aria-label="Expand map" aria-pressed="false" title="Expand map">&#x26F6;</button>
</div>
<figcaption>Millfield Bank.</figcaption>
</figure>
</div>


### 4. Sign the corrected page with Pitmaster Dorn.

Back to the square. He will have a pen ready; he always has a pen ready.

<nav class="corealm-quest-where" aria-label="Locations for step 4"><span>Where</span><a href="../../regions/#millfield-square">Millfield Square</a></nav>
<div class="corealm-quest-step-evidence">
<div class="corealm-quest-scenes"><figure class="corealm-quest-scene"><img class="codex-card__shot" src="../../assets/captures/thumbs/npcs/npc_pitmaster_dorn.webp" alt="Pitmaster Dorn in the running Corealm world" width="480" height="270" loading="lazy" decoding="async" /><figcaption><strong>Pitmaster Dorn</strong><span>Millfield Bank, Farmland</span></figcaption></figure></div>
<figure class="corealm-location-map corealm-quest-map" data-location-map
 data-map-focus="36.483,78.091,36.483,78.091"
 style="--map-image-ratio:0.72727">
<div class="corealm-map-viewport" data-map-viewport role="region" tabindex="0" aria-label="Map for Dorn's Tally, step 4">
<div class="corealm-map-stage" data-map-stage>
<img src="../../assets/world-map.webp" alt="Overhead map rendered from the Corealm game world" draggable="false" />
<a class="corealm-map-marker" href="../../npcs/#pitmaster-dorn" style="--map-x:36.4833%;--map-y:78.0909%" data-map-side="right" data-map-kind="npc" data-map-marker aria-label="Pitmaster Dorn, Farmland" title="Pitmaster Dorn, Farmland"><span>Pitmaster Dorn<small>Farmland</small></span></a>
</div>
<span class="corealm-map-north" aria-hidden="true">N</span>
<div class="corealm-map-controls corealm-map-controls-zoom" aria-label="Map zoom controls">
<button type="button" data-map-action="out" aria-label="Zoom out" title="Zoom out">&minus;</button>
<button type="button" data-map-action="reset" aria-label="Reset map" title="Reset map">&#x25CE;</button>
<button type="button" data-map-action="in" aria-label="Zoom in" title="Zoom in">+</button>
</div>
<button class="corealm-map-expand" type="button" data-map-action="expand" aria-label="Expand map" aria-pressed="false" title="Expand map">&#x26F6;</button>
</div>
<figcaption>Millfield Square.</figcaption>
</figure>
</div>


## Completion rewards

| Reward | Amount |
| --- | --- |
| Mining XP | 260 |
| [Copper Pickaxe](../../items/grithe_pickaxe/) | 1 |
| Marks | 220 |
| Unlock | Dorn will quote you real seam figures instead of the ledger's. |
