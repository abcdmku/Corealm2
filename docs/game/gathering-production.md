---
title: "Gathering and production"
description: "The level 1, 5, and 10 gathering loops, generated from the live tier, resource, item, and recipe tables."
---

These tables are a content check as much as a player guide. A tier appears here only when the canonical catalog resolves its resources, items, and recipes.

## 1. Mining and Smithing

March Stone remains the flux for every bar. This keeps the level 1 mine useful after later metal tiers unlock.

### Mining unlocks

| Level | Node | Primary yield | Secondary yield | XP | Per node | Respawn |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Copper Seam | [Copper Ore](./items/#copper-ore) | [Quartz](./items/#quartz) at 6% | 10 | 8-15 | 21 s |
| 1 | Limestone Face | [Limestone](./items/#limestone) | [Quartz](./items/#quartz) at 3% | 10 | 8-15 | 21 s |
| 5 | Iron Seam | [Iron Ore](./items/#iron-ore) | [Amber](./items/#amber) at 6% | 24 | 8-15 | 32 s |
| 10 | Cobalt Face | [Cobalt Ore](./items/#cobalt-ore) | [Garnet](./items/#garnet) at 7% | 35 | 8-14 | 43 s |
| 20 | Titanium Seam | [Titanium Ore](./items/#titanium-ore) | [Fire Opal](./items/#fire-opal) at 7% | 52 | 7-14 | 65 s |
| 20 | Flux Stone Face | [Flux Stone](./items/#flux-stone) | [Fire Opal](./items/#fire-opal) at 3% | 52 | 7-14 | 65 s |

### Smithing unlocks

| Level | Bar recipe | Station | Time | XP | Finished equipment |
| --- | --- | --- | --- | --- | --- |
| 1 | 1× Copper Ore + 1× Limestone → 1× Copper Bar | Furnace | 2.4 s | 8 | [Copper Dagger](./items/#copper-dagger), [Copper Sword](./items/#copper-sword), [Copper Helm](./items/#copper-helm), [Copper Cuirass](./items/#copper-cuirass), [Copper Greaves](./items/#copper-greaves), [Copper Boots](./items/#copper-boots), [Copper Gloves](./items/#copper-gloves), [Copper Pickaxe](./items/#copper-pickaxe), [Copper Hatchet](./items/#copper-hatchet) |
| 5 | 2× Iron Ore + 1× Limestone → 1× Iron Bar | Furnace | 2.4 s | 19 | [Iron Dagger](./items/#iron-dagger), [Iron Sword](./items/#iron-sword), [Iron Helm](./items/#iron-helm), [Iron Plate](./items/#iron-plate), [Iron Greaves](./items/#iron-greaves), [Iron Boots](./items/#iron-boots), [Iron Gauntlets](./items/#iron-gauntlets), [Iron Pickaxe](./items/#iron-pickaxe), [Iron Hatchet](./items/#iron-hatchet) |
| 10 | 2× Cobalt Ore + 2× Limestone → 1× Cobalt Bar | Furnace | 2.4 s | 28 | [Cobalt Dagger](./items/#cobalt-dagger), [Cobalt Sword](./items/#cobalt-sword), [Cobalt Helm](./items/#cobalt-helm), [Cobalt Plate](./items/#cobalt-plate), [Cobalt Greaves](./items/#cobalt-greaves), [Cobalt Boots](./items/#cobalt-boots), [Cobalt Gauntlets](./items/#cobalt-gauntlets), [Cobalt Pickaxe](./items/#cobalt-pickaxe), [Cobalt Hatchet](./items/#cobalt-hatchet), [Cobalt Pickaxe](./items/#cobalt-pickaxe), [Cobalt Helm](./items/#cobalt-helm) |
| 20 | 3× Titanium Ore + 2× Flux Stone → 1× Titanium Bar | Furnace | 2.4 s | 42 | [Titanium Dagger](./items/#titanium-dagger), [Titanium Sword](./items/#titanium-sword), [Titanium Helm](./items/#titanium-helm), [Titanium Plate](./items/#titanium-plate), [Titanium Greaves](./items/#titanium-greaves), [Titanium Boots](./items/#titanium-boots), [Titanium Gauntlets](./items/#titanium-gauntlets), [Titanium Pickaxe](./items/#titanium-pickaxe), [Titanium Hatchet](./items/#titanium-hatchet), [Titanium Dagger](./items/#titanium-dagger) |

## 2. Fishing and Cooking

A range and a player-built campfire use the same recipe and burn chance. Raw and burnt fish are not food.

| Level | Fishing spot | Raw fish | Cooked food | Heal | Cooking XP | Stations | Time | Burn at unlock | Burnt result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | River Shallow | [Minnow](./items/#minnow) | [Seared Minnow](./items/#seared-minnow) | 3 | 15 | Range / Campfire | 2.4 s | 45% | [Burnt Minnow](./items/#burnt-minnow) |
| 5 | Blackwater Pool | [Trout](./items/#trout) | [Seared Trout](./items/#seared-trout) | 7 | 36 | Range / Campfire | 2.4 s | 45% | [Burnt Trout](./items/#burnt-trout) |
| 10 | Mountain Lake | [Perch](./items/#perch) | [Seared Perch](./items/#seared-perch) | 12 | 53 | Range / Campfire | 2.4 s | 45% | [Burnt Perch](./items/#burnt-perch) |
| 20 | Hot Spring | [Bass](./items/#bass) | [Seared Bass](./items/#seared-bass) | 19 | 78 | Range / Campfire | 2.4 s | 45% | [Burnt Bass](./items/#burnt-bass) |

Burn chance is `clamp(0.45 - 0.030 × (Cooking level - recipe level), 0, 0.45)`. Cooked fish takes 1.8 seconds to eat and cannot heal above maximum health.

## 3. Woodcutting, Fletching, and Crafting

Each log tier supplies the reusable shafts and handles used by wooden gear and handled metal equipment.

### Wood and Fletching unlocks

| Level | Tree | Log | Shafts | Handles | Wooden equipment |
| --- | --- | --- | --- | --- | --- |
| 1 | Pine | [Pine Log](./items/#pine-log) | 1× Pine Log → 4× Pine Shaft for 10 XP | 1× Pine Log → 2× Pine Handle for 10 XP | [Pine Staff](./items/#pine-staff) from 3× Pine Shaft; [Pine Wand](./items/#pine-wand) from 2× Pine Shaft; [Pine Shield](./items/#pine-shield) from 2× Pine Log + 1× Copper Bar; [Pine Rod](./items/#pine-rod) from 2× Pine Shaft + 1× Coarse Hide; [Basic Wooden Wand](./items/#basic-wooden-wand) from 1× Pine Shaft; [Basic Wooden Staff](./items/#basic-wooden-staff) from 2× Pine Shaft |
| 5 | Ash | [Ash Log](./items/#ash-log) | 1× Ash Log → 4× Ash Shaft for 24 XP | 1× Ash Log → 2× Ash Handle for 24 XP | [Ash Staff](./items/#ash-staff) from 3× Ash Shaft; [Ash Wand](./items/#ash-wand) from 2× Ash Shaft; [Ash Shield](./items/#ash-shield) from 2× Ash Log + 1× Iron Bar; [Ash Rod](./items/#ash-rod) from 2× Ash Shaft + 1× Thick Hide; [Ash Rod](./items/#ash-rod) from 3× Horsehair + 2× Ash Shaft; [Ash Shield](./items/#ash-shield) from 3× Snail Mucus + 2× Ash Log |
| 10 | Oak | [Oak Log](./items/#oak-log) | 1× Oak Log → 4× Oak Shaft for 35 XP | 1× Oak Log → 2× Oak Handle for 35 XP | [Oak Staff](./items/#oak-staff) from 3× Oak Shaft; [Oak Wand](./items/#oak-wand) from 2× Oak Shaft; [Oak Shield](./items/#oak-shield) from 2× Oak Log + 1× Cobalt Bar; [Oak Rod](./items/#oak-rod) from 2× Oak Shaft + 1× Fur Pelt; [Oak Shield](./items/#oak-shield) from 3× Tortoise Shell Plate + 2× Oak Log |
| 20 | Walnut | [Walnut Log](./items/#walnut-log) | 1× Walnut Log → 4× Walnut Shaft for 52 XP | 1× Walnut Log → 2× Walnut Handle for 52 XP | [Walnut Staff](./items/#walnut-staff) from 3× Walnut Shaft; [Walnut Wand](./items/#walnut-wand) from 2× Walnut Shaft; [Walnut Shield](./items/#walnut-shield) from 2× Walnut Log + 1× Titanium Bar; [Walnut Rod](./items/#walnut-rod) from 2× Walnut Shaft + 1× Heavy Hide; [Walnut Rod](./items/#walnut-rod) from 3× Monitor Lizard Sinew + 2× Walnut Shaft |

### Mining and Crafting bridge

| Level | Gem | Crafting outputs |
| --- | --- | --- |
| 1 | [Quartz](./items/#quartz) | [Air Wand](./items/#air-wand) from 1× Pine Wand; [Air Staff](./items/#air-staff) from 1× Pine Staff; [Copper Ring](./items/#copper-ring) from 1× Copper Bar + 1× Quartz; [Copper Pendant](./items/#copper-pendant) from 1× Copper Bar + 1× Quartz; [Ember Ring](./items/#ember-ring) from 1× Copper Bar + 2× Quartz; [Ember Charm](./items/#ember-charm) from 2× Quartz; [Hide Robe](./items/#hide-robe) from 3× Coarse Hide; [Hide Leggings](./items/#hide-leggings) from 2× Coarse Hide; [Hide Hood](./items/#hide-hood) from 1× Coarse Hide; [Hide Boots](./items/#hide-boots) from 1× Coarse Hide; [Hide Wraps](./items/#hide-wraps) from 1× Coarse Hide; [Fox Fur Ring](./items/#fox-fur-ring) from 3× Fox Fur + 1× Copper Bar + 1× Quartz; [Hide Robe](./items/#hide-robe) from 3× Goose Down + 2× Coarse Hide; [Turkey Plume Charm](./items/#turkey-plume-charm) from 3× Turkey Tail Feather + 1× Copper Bar + 1× Quartz |
| 5 | [Amber](./items/#amber) | [Earth Wand](./items/#earth-wand) from 1× Ash Wand; [Earth Staff](./items/#earth-staff) from 1× Ash Staff; [Iron Ring](./items/#iron-ring) from 1× Iron Bar + 1× Amber; [Iron Pendant](./items/#iron-pendant) from 1× Iron Bar + 1× Amber; [Stone Ring](./items/#stone-ring) from 1× Iron Bar + 2× Amber; [Stone Charm](./items/#stone-charm) from 2× Amber; [Thick Hide Robe](./items/#thick-hide-robe) from 3× Thick Hide; [Thick Hide Leggings](./items/#thick-hide-leggings) from 2× Thick Hide; [Thick Hide Hood](./items/#thick-hide-hood) from 1× Thick Hide; [Thick Hide Boots](./items/#thick-hide-boots) from 1× Thick Hide; [Thick Hide Wraps](./items/#thick-hide-wraps) from 1× Thick Hide; [Lynx Sinew Ring](./items/#lynx-sinew-ring) from 3× Lynx Sinew + 1× Iron Bar + 1× Amber; [Thick Hide Leggings](./items/#thick-hide-leggings) from 3× Badger Bristle + 1× Thick Hide; [Thick Hide](./items/#thick-hide) from 3× Tapir Leather; [Heron Quill Charm](./items/#heron-quill-charm) from 3× Heron Quill + 1× Iron Bar + 1× Amber; [Thick Hide Robe](./items/#thick-hide-robe) from 3× Spider Silk + 2× Thick Hide |
| 10 | [Garnet](./items/#garnet) | [Water Wand](./items/#water-wand) from 1× Oak Wand; [Water Staff](./items/#water-staff) from 1× Oak Staff; [Cobalt Ring](./items/#cobalt-ring) from 1× Cobalt Bar + 1× Garnet; [Cobalt Pendant](./items/#cobalt-pendant) from 1× Cobalt Bar + 1× Garnet; [Storm Ring](./items/#storm-ring) from 1× Cobalt Bar + 2× Garnet; [Storm Charm](./items/#storm-charm) from 2× Garnet; [Fur Robe](./items/#fur-robe) from 3× Fur Pelt; [Fur Leggings](./items/#fur-leggings) from 2× Fur Pelt; [Fur Hood](./items/#fur-hood) from 1× Fur Pelt; [Fur Boots](./items/#fur-boots) from 1× Fur Pelt; [Fur Wraps](./items/#fur-wraps) from 1× Fur Pelt; [Porcupine Quill Ring](./items/#porcupine-quill-ring) from 3× Porcupine Quill + 1× Cobalt Bar + 1× Garnet; [Fur Leggings](./items/#fur-leggings) from 3× Bighorn Wool + 1× Fur Pelt; [Antler Charm](./items/#antler-charm) from 3× Moose Antler + 1× Cobalt Bar + 1× Garnet; [Fur Boots](./items/#fur-boots) from 3× Crocodile Armor Plate + 1× Fur Pelt; [Fur Robe](./items/#fur-robe) from 3× Bustard Plume + 2× Fur Pelt |
| 20 | [Fire Opal](./items/#fire-opal) | [Fire Wand](./items/#fire-wand) from 1× Walnut Wand; [Fire Staff](./items/#fire-staff) from 1× Walnut Staff; [Titanium Ring](./items/#titanium-ring) from 1× Titanium Bar + 1× Fire Opal; [Titanium Pendant](./items/#titanium-pendant) from 1× Titanium Bar + 1× Fire Opal; [Cinder Ring](./items/#cinder-ring) from 1× Titanium Bar + 2× Fire Opal; [Cinder Charm](./items/#cinder-charm) from 2× Fire Opal; [Heavy Hide Robe](./items/#heavy-hide-robe) from 3× Heavy Hide; [Heavy Hide Leggings](./items/#heavy-hide-leggings) from 2× Heavy Hide; [Heavy Hide Hood](./items/#heavy-hide-hood) from 1× Heavy Hide; [Heavy Hide Boots](./items/#heavy-hide-boots) from 1× Heavy Hide; [Heavy Hide Wraps](./items/#heavy-hide-wraps) from 1× Heavy Hide; [Chitin Ring](./items/#chitin-ring) from 3× Centipede Chitin + 1× Titanium Bar + 1× Fire Opal; [Heavy Hide](./items/#heavy-hide) from 3× Armored Dragon Scale; [Mantis Edge Charm](./items/#mantis-edge-charm) from 3× Mantis Claw + 1× Titanium Bar + 1× Fire Opal |

[Campfire fuel, lifetime, and build XP](./campfires) also derive from each tier's log row.
