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
| 1 | Copper Seam | [Copper Ore](../items/grithe_ore/) | [Quartz](../items/pale_quartz/) at 6% | 10 | 8-15 | 21 s |
| 1 | Limestone Face | [Limestone](../items/march_stone/) | [Quartz](../items/pale_quartz/) at 3% | 10 | 8-15 | 21 s |
| 5 | Iron Seam | [Iron Ore](../items/corven_ore/) | [Amber](../items/vell_amber/) at 6% | 24 | 8-15 | 32 s |
| 10 | Cobalt Face | [Cobalt Ore](../items/kaldite_ore/) | [Garnet](../items/cairn_garnet/) at 7% | 35 | 8-14 | 43 s |
| 20 | Titanium Seam | [Titanium Ore](../items/emberite_ore/) | [Fire Opal](../items/fire_opal/) at 7% | 52 | 7-14 | 65 s |
| 20 | Flux Stone Face | [Flux Stone](../items/kilnstone/) | [Fire Opal](../items/fire_opal/) at 3% | 52 | 7-14 | 65 s |

### Smithing unlocks

| Level | Bar recipe | Station | Time | XP | Finished equipment |
| --- | --- | --- | --- | --- | --- |
| 1 | 1× Copper Ore + 1× Limestone → 1× Copper Bar | Furnace | 2.4 s | 8 | [Copper Dagger](../items/grithe_dagger/), [Copper Sword](../items/grithe_sword/), [Copper Helm](../items/grithe_helm/), [Copper Cuirass](../items/grithe_cuirass/), [Copper Greaves](../items/grithe_greaves/), [Copper Boots](../items/grithe_boots/), [Copper Gloves](../items/grithe_gloves/), [Copper Pickaxe](../items/grithe_pickaxe/), [Copper Hatchet](../items/grithe_hatchet/) |
| 5 | 2× Iron Ore + 1× Limestone → 1× Iron Bar | Furnace | 2.4 s | 19 | [Iron Dagger](../items/corven_dagger/), [Iron Sword](../items/corven_sword/), [Iron Helm](../items/corven_helm/), [Iron Plate](../items/corven_plate/), [Iron Greaves](../items/corven_greaves/), [Iron Boots](../items/corven_boots/), [Iron Gauntlets](../items/corven_gauntlets/), [Iron Pickaxe](../items/corven_pickaxe/), [Iron Hatchet](../items/corven_hatchet/) |
| 10 | 2× Cobalt Ore + 2× Limestone → 1× Cobalt Bar | Furnace | 2.4 s | 28 | [Cobalt Dagger](../items/kaldite_dagger/), [Cobalt Sword](../items/kaldite_sword/), [Cobalt Helm](../items/kaldite_helm/), [Cobalt Plate](../items/kaldite_plate/), [Cobalt Greaves](../items/kaldite_greaves/), [Cobalt Boots](../items/kaldite_boots/), [Cobalt Gauntlets](../items/kaldite_gauntlets/), [Cobalt Pickaxe](../items/kaldite_pickaxe/), [Cobalt Hatchet](../items/kaldite_hatchet/), [Cobalt Pickaxe](../items/kaldite_pickaxe/), [Cobalt Helm](../items/kaldite_helm/) |
| 20 | 3× Titanium Ore + 2× Flux Stone → 1× Titanium Bar | Furnace | 2.4 s | 42 | [Titanium Dagger](../items/emberite_dagger/), [Titanium Sword](../items/emberite_sword/), [Titanium Helm](../items/emberite_helm/), [Titanium Plate](../items/emberite_plate/), [Titanium Greaves](../items/emberite_greaves/), [Titanium Boots](../items/emberite_boots/), [Titanium Gauntlets](../items/emberite_gauntlets/), [Titanium Pickaxe](../items/emberite_pickaxe/), [Titanium Hatchet](../items/emberite_hatchet/), [Titanium Dagger](../items/emberite_dagger/) |

## 2. Fishing and Cooking

A range and a player-built campfire use the same recipe and burn chance. Raw and burnt fish are not food.

| Level | Fishing spot | Raw fish | Cooked food | Heal | Cooking XP | Stations | Time | Burn at unlock | Burnt result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | River Shallow | [Minnow](../items/silt_minnow/) | [Seared Minnow](../items/seared_minnow/) | 3 | 15 | Range / Campfire | 2.4 s | 45% | [Burnt Minnow](../items/burnt_minnow/) |
| 5 | Blackwater Pool | [Trout](../items/bramble_trout/) | [Seared Trout](../items/seared_trout/) | 7 | 36 | Range / Campfire | 2.4 s | 45% | [Burnt Trout](../items/burnt_trout/) |
| 10 | Mountain Lake | [Perch](../items/cragfin/) | [Seared Perch](../items/seared_cragfin/) | 12 | 53 | Range / Campfire | 2.4 s | 45% | [Burnt Perch](../items/burnt_cragfin/) |
| 20 | Hot Spring | [Bass](../items/ashfin/) | [Seared Bass](../items/seared_ashfin/) | 19 | 78 | Range / Campfire | 2.4 s | 45% | [Burnt Bass](../items/burnt_ashfin/) |

Burn chance is `clamp(0.45 - 0.030 × (Cooking level - recipe level), 0, 0.45)`. Cooked fish takes 1.8 seconds to eat and cannot heal above maximum health.

## 3. Woodcutting, Fletching, and Crafting

Each log tier supplies the reusable shafts and handles used by wooden gear and handled metal equipment.

### Wood and Fletching unlocks

| Level | Tree | Log | Shafts | Handles | Wooden equipment |
| --- | --- | --- | --- | --- | --- |
| 1 | Pine | [Pine Log](../items/palewood_log/) | 1× Pine Log → 4× Pine Shaft for 10 XP | 1× Pine Log → 2× Pine Handle for 10 XP | [Pine Staff](../items/palewood_staff/) from 3× Pine Shaft; [Pine Wand](../items/palewood_wand/) from 2× Pine Shaft; [Pine Shield](../items/palewood_shield/) from 2× Pine Log + 1× Copper Bar; [Pine Rod](../items/palewood_rod/) from 2× Pine Shaft + 1× Coarse Hide; [Basic Wooden Wand](../items/basic_wooden_wand/) from 1× Pine Shaft; [Basic Wooden Staff](../items/basic_wooden_staff/) from 2× Pine Shaft |
| 5 | Ash | [Ash Log](../items/duskoak_log/) | 1× Ash Log → 4× Ash Shaft for 24 XP | 1× Ash Log → 2× Ash Handle for 24 XP | [Ash Staff](../items/duskoak_staff/) from 3× Ash Shaft; [Ash Wand](../items/duskoak_wand/) from 2× Ash Shaft; [Ash Shield](../items/duskoak_shield/) from 2× Ash Log + 1× Iron Bar; [Ash Rod](../items/duskoak_rod/) from 2× Ash Shaft + 1× Thick Hide; [Ash Rod](../items/duskoak_rod/) from 3× Horsehair + 2× Ash Shaft; [Ash Shield](../items/duskoak_shield/) from 3× Snail Mucus + 2× Ash Log |
| 10 | Oak | [Oak Log](../items/cairnpine_log/) | 1× Oak Log → 4× Oak Shaft for 35 XP | 1× Oak Log → 2× Oak Handle for 35 XP | [Oak Staff](../items/cairnpine_staff/) from 3× Oak Shaft; [Oak Wand](../items/cairnpine_wand/) from 2× Oak Shaft; [Oak Shield](../items/cairnpine_shield/) from 2× Oak Log + 1× Cobalt Bar; [Oak Rod](../items/cairnpine_rod/) from 2× Oak Shaft + 1× Fur Pelt; [Oak Shield](../items/cairnpine_shield/) from 3× Tortoise Shell Plate + 2× Oak Log |
| 20 | Walnut | [Walnut Log](../items/cinderpine_log/) | 1× Walnut Log → 4× Walnut Shaft for 52 XP | 1× Walnut Log → 2× Walnut Handle for 52 XP | [Walnut Staff](../items/cinderpine_staff/) from 3× Walnut Shaft; [Walnut Wand](../items/cinderpine_wand/) from 2× Walnut Shaft; [Walnut Shield](../items/cinderpine_shield/) from 2× Walnut Log + 1× Titanium Bar; [Walnut Rod](../items/cinderpine_rod/) from 2× Walnut Shaft + 1× Heavy Hide; [Walnut Rod](../items/cinderpine_rod/) from 3× Monitor Lizard Sinew + 2× Walnut Shaft |

### Mining and Crafting bridge

| Level | Gem | Crafting outputs |
| --- | --- | --- |
| 1 | [Quartz](../items/pale_quartz/) | [Air Wand](../items/air_wand/) from 1× Pine Wand; [Air Staff](../items/air_staff/) from 1× Pine Staff; [Copper Ring](../items/grithe_ring/) from 1× Copper Bar + 1× Quartz; [Copper Pendant](../items/grithe_pendant/) from 1× Copper Bar + 1× Quartz; [Ember Ring](../items/ember_ring/) from 1× Copper Bar + 2× Quartz; [Ember Charm](../items/ember_charm/) from 2× Quartz; [Hide Robe](../items/marchhide_robe/) from 3× Coarse Hide; [Hide Leggings](../items/marchhide_leggings/) from 2× Coarse Hide; [Hide Hood](../items/marchhide_hood/) from 1× Coarse Hide; [Hide Boots](../items/marchhide_boots/) from 1× Coarse Hide; [Hide Wraps](../items/marchhide_wraps/) from 1× Coarse Hide; [Fox Fur Ring](../items/foxhair_ring/) from 3× Fox Fur + 1× Copper Bar + 1× Quartz; [Hide Robe](../items/marchhide_robe/) from 3× Goose Down + 2× Coarse Hide; [Turkey Plume Charm](../items/turkey_plume_charm/) from 3× Turkey Tail Feather + 1× Copper Bar + 1× Quartz |
| 5 | [Amber](../items/vell_amber/) | [Earth Wand](../items/earth_wand/) from 1× Ash Wand; [Earth Staff](../items/earth_staff/) from 1× Ash Staff; [Iron Ring](../items/corven_ring/) from 1× Iron Bar + 1× Amber; [Iron Pendant](../items/corven_pendant/) from 1× Iron Bar + 1× Amber; [Stone Ring](../items/stone_ring/) from 1× Iron Bar + 2× Amber; [Stone Charm](../items/stone_charm/) from 2× Amber; [Thick Hide Robe](../items/bramblehide_robe/) from 3× Thick Hide; [Thick Hide Leggings](../items/bramblehide_leggings/) from 2× Thick Hide; [Thick Hide Hood](../items/bramblehide_hood/) from 1× Thick Hide; [Thick Hide Boots](../items/bramblehide_boots/) from 1× Thick Hide; [Thick Hide Wraps](../items/bramblehide_wraps/) from 1× Thick Hide; [Lynx Sinew Ring](../items/lynx_sinew_ring/) from 3× Lynx Sinew + 1× Iron Bar + 1× Amber; [Thick Hide Leggings](../items/bramblehide_leggings/) from 3× Badger Bristle + 1× Thick Hide; [Thick Hide](../items/bramble_hide/) from 3× Tapir Leather; [Heron Quill Charm](../items/heron_quill_charm/) from 3× Heron Quill + 1× Iron Bar + 1× Amber; [Thick Hide Robe](../items/bramblehide_robe/) from 3× Spider Silk + 2× Thick Hide |
| 10 | [Garnet](../items/cairn_garnet/) | [Water Wand](../items/water_wand/) from 1× Oak Wand; [Water Staff](../items/water_staff/) from 1× Oak Staff; [Cobalt Ring](../items/kaldite_ring/) from 1× Cobalt Bar + 1× Garnet; [Cobalt Pendant](../items/kaldite_pendant/) from 1× Cobalt Bar + 1× Garnet; [Storm Ring](../items/storm_ring/) from 1× Cobalt Bar + 2× Garnet; [Storm Charm](../items/storm_charm/) from 2× Garnet; [Fur Robe](../items/cairnpelt_robe/) from 3× Fur Pelt; [Fur Leggings](../items/cairnpelt_leggings/) from 2× Fur Pelt; [Fur Hood](../items/cairnpelt_hood/) from 1× Fur Pelt; [Fur Boots](../items/cairnpelt_boots/) from 1× Fur Pelt; [Fur Wraps](../items/cairnpelt_wraps/) from 1× Fur Pelt; [Porcupine Quill Ring](../items/quillguard_ring/) from 3× Porcupine Quill + 1× Cobalt Bar + 1× Garnet; [Fur Leggings](../items/cairnpelt_leggings/) from 3× Bighorn Wool + 1× Fur Pelt; [Antler Charm](../items/antler_palm_charm/) from 3× Moose Antler + 1× Cobalt Bar + 1× Garnet; [Fur Boots](../items/cairnpelt_boots/) from 3× Crocodile Armor Plate + 1× Fur Pelt; [Fur Robe](../items/cairnpelt_robe/) from 3× Bustard Plume + 2× Fur Pelt |
| 20 | [Fire Opal](../items/fire_opal/) | [Fire Wand](../items/fire_wand/) from 1× Walnut Wand; [Fire Staff](../items/fire_staff/) from 1× Walnut Staff; [Titanium Ring](../items/emberite_ring/) from 1× Titanium Bar + 1× Fire Opal; [Titanium Pendant](../items/emberite_pendant/) from 1× Titanium Bar + 1× Fire Opal; [Cinder Ring](../items/cinder_ring/) from 1× Titanium Bar + 2× Fire Opal; [Cinder Charm](../items/cinder_charm/) from 2× Fire Opal; [Heavy Hide Robe](../items/charhide_robe/) from 3× Heavy Hide; [Heavy Hide Leggings](../items/charhide_leggings/) from 2× Heavy Hide; [Heavy Hide Hood](../items/charhide_hood/) from 1× Heavy Hide; [Heavy Hide Boots](../items/charhide_boots/) from 1× Heavy Hide; [Heavy Hide Wraps](../items/charhide_wraps/) from 1× Heavy Hide; [Chitin Ring](../items/chitin_ring/) from 3× Centipede Chitin + 1× Titanium Bar + 1× Fire Opal; [Heavy Hide](../items/charhide/) from 3× Armored Dragon Scale; [Mantis Edge Charm](../items/mantis_edge_charm/) from 3× Mantis Claw + 1× Titanium Bar + 1× Fire Opal |

[Campfire fuel, lifetime, and build XP](../campfires/) also derive from each tier's log row.
