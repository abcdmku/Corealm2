# Wilderness materials and equipment

`game/src/content/wildernessLoot.ts` contains 62 items and 49 recipes for the T50 shallow Wilderness and T70 deep Wilderness. Every added material feeds a recipe. Every added tool or piece of equipment has a recipe reachable from gathering and monster drops.

The module stays separate from registration. Root now registers its 62 items and 49 recipes globally after the production, loot collection and equipped appearance checks in the feature lab.

| Source | T50 material | T70 material | Use |
| --- | --- | --- | --- |
| Mines | Cindervein Ore | Nightglass Ore | Three ore and one creature core make one bar. |
| Stone creatures | Molten Heart | Astral Core | Flux for Cindersteel or Nightglass bars. |
| Dragons | Dragonhide | Starhide | Five pieces of casting armour at the matching tier. |
| Spirits and other Wilderness creatures | Grave Thread | Void Thread | Casting armour, wands, staffs and caster jewellery. |
| Living groves | Teak Log | Magic Log | Weapon and tool handles, shields, wands and staffs. |

Fire Opals remain the existing gem input for both jewellery tiers. Ordinary creatures can drop one at 4%; keepers can drop one or two at 35%. This gives the northern jewellery recipes a local gem source while keeping Kilnhalt gems useful.

Both equipment tiers contain a sword, shield, full five-piece melee armour, melee ring and pendant, wand, staff, full five-piece casting armour, caster ring and charm, pickaxe and hatchet. Ranged equipment is absent because the production game has melee and magic combat skills. No unused ranged stats or speculative combat rules are added.

Staffs use the production two-hand rule and 3-second cadence. Wands keep the off hand free and cast every 2.2 seconds, with lower accuracy and power. These weapons use carried Essence and the merged invocation runes. They do not invent new elements, orbs, charges or spell discounts.

| Regular kit | Weapon accuracy | Weapon power | Full kit armour | Full kit magic armour | Full kit vitality |
| --- | ---: | ---: | ---: | ---: | ---: |
| T50 Cindersteel sword kit | 92 | 92 | 209 | 82 | 45 |
| T70 Nightglass sword kit | 125 | 128 | 274 | 110 | 62 |
| T50 Dragonhide and Teak Staff kit | 80 magic | 69 magic | 25 | 153 | 40 |
| T70 Starhide and Magic Staff kit | 110 magic | 94 magic | 35 | 216 | 56 |

Armour contributes no melee power. A complete T50 casting kit has 146 magic accuracy and 97 magic power; T70 has 201 and 132. Tool bonuses use the existing capped `toolBonus` formula, giving +39 effective gathering levels at T50 and +40 at T70. Resource skill requirements still apply.

## Rune keepers and fortress upgrades

The five keeper identities come from root-owned `wildernessDepth.ts`. The actual rune IDs are the merged spell catalogue's Mind, Chaos, Death, Blood and Wrath Runes. Cosmic Runes accompany area invocations.

| Keeper | Rune | Unique material | Equipment upgrade |
| --- | --- | --- | --- |
| Ashseal Warden, T50 | Mind | Ashseal Iron | Teak Shield into Ashseal Guard |
| Furnace Regent, T50 | Chaos | Furnace Crown | Teak Staff into Regent Staff |
| Chainbound Archon, T70 | Death | Chainbound Link | Nightglass Sword into Chainbound Sword |
| Nightforge Marshal, T70 | Blood | Nightforge Seal | Nightglass Plate into Nightmarshal Plate |
| The Hollow Star, T70 | Wrath | Hollow Star Fragment | Magic Staff into Hollowstar Staff |

Each keeper guarantees 24–40 matching invocation runes, 24–40 Cosmic Runes, one or two unique components, five to nine ordinary materials and three to six matching ore. Three unique components complete one upgrade, along with its existing base equipment and additional local material. The upgraded pieces retain their region's equipment requirements.

Ordinary shallow creatures supply Mind Runes at 40% for two to four and Chaos Runes at 28% for two or three. Deep creatures supply Death Runes at 32% for two to four, Blood Runes at 22% for one to three, and Wrath Runes at 10% for one or two. Both zones supply two to four Cosmic Runes at 40%. Every ordinary kill guarantees one to three useful creature materials.

Foundry guards have a 12% chance for one Chainbound Link. Bastion guards have the same chance for one Nightforge Seal; sanctum guards can supply one Hollow Star Fragment. These drops belong only to the matching fortress packs, giving their dense fights a reward distinct from nearby open ground.

## Integration and evidence

Root registers `WILDERNESS_LOOT_ITEMS` with items and `WILDERNESS_LOOT_RECIPES` with recipes. The resource module references `cindervein_vein` and `nightglass_vein`, which yield this module's `cindervein_ore` and `nightglass_ore`. Trees reuse `tree_teak` / `teak_log` and `tree_magic` / `magic_log`.

Use `wildernessDrops(speciesId, tier, keeperId?, structureId?)` to assign an enemy's table. Pass the keeper's exact id for the five minibosses. The optional structure id is `cinder_chain_foundry`, `nightforge_bastion` or `hollow_star_sanctum`; it adds that location's component to an ordinary guard. Unknown keeper IDs fail instead of silently omitting rune rewards.

Root owns the render equipment table and item icon registration. `WILDERNESS_CRAFTING_TIERS` exposes the item prefixes; unique gear IDs are `ashseal_guard`, `regent_staff`, `chainbound_sword`, `nightmarshal_plate` and `hollowstar_staff`. No public asset or appearance table is edited by this worker.

`npx vitest run tests/wilderness-loot.test.ts` passes 63 checks. All 49 recipes run through the real ProductionSystem and ActivitySystem, with exact inputs, outputs, timing and XP. Other checks cover production level gates, item references, material reachability, complete equipment slots, weapon hands/cadence, keeper runes and local fortress rewards. The seven checks in `tests/wilderness-enemy-progression.test.ts` cover the pure enemy tuning helper, legacy movement preservation, keeper levels, northward progression and fortress drop scope.

The serialized browser gate is `npx tsx tools/wilderness-loot-lab-test.ts`. Add `--url http://127.0.0.1:4173` to reuse a server and `--catalog test-results/wilderness-creatures/keepers/catalog.json` while the keeper is still a staged asset. It has a 60-second hard deadline and a 56-second operation budget. Evidence goes to `test-results/wilderness-loot-lab/report.json` and four screenshots. The script checks the staged GLB sizes and SHA-256 before boot.

The accepted browser run passed in 26.5 seconds. The missing ingredient gate, both production recipes, equipped layer assets, actual keeper death and pointer loot collection all succeeded. The Furnace Regent supplied 38 Chaos Runes and 39 Cosmic Runes. A ground cast of Furnace Whip spent exactly one of each plus one Fire Essence, leaving 37 Chaos, 38 Cosmic and two Essence. Its visible orange ribbon and cinders were accepted from `04-earned-rune-cast.png`; the report records four active shapes, 4,420 peak particles and a 576-triangle lash submitted to both the canvas colour pass and the offscreen emission pass. Browser, request and game error lists were empty.

The crafting and equipment captures show the disabled missing-thread Make button and the red-brown hood with a deep-blue robe fitted to the player rig. The loot capture shows the remaining components after rune collection, with exact collected quantities in the report. This is functional and visual acceptance of the crafting, rewards and spell supply path. A measured 883.4 ms first-cast frame gap remains a performance limitation.

The gate opens the real lab crafting table through a canvas hover, right click and Use action. A pointer click on a disabled Make button must leave the inventory unchanged while one Grave Thread is missing. After supplying that thread, real Make actions produce a T50 Dragonhide Hood and T70 Starhide Robe with exact inventory and XP deltas. Inventory clicks equip those crafted outputs. The player rig must report their committed layer assets and submit its layer meshes to the colour pass.

For the reward path, the gate spawns the production Furnace Regent and uses the explicit fixture control to set its current health to one. The report records its original and maximum health, and checks that its other combat stats are unchanged. The lab equipment control supplies a Chainbound Sword and Magic Staff for combat setup. A real attack must cause death and create a loot container. Pointer clicks collect the actual Chaos and Cosmic Rune stacks. The spellbook's Furnace Whip tile then opens the production ground reticle, and a ground click must consume one earned Chaos Rune, one earned Cosmic Rune and one granted Fire Essence. This checks the reward and spell supply path, not the difficulty of a full keeper fight.

All acceptance captures use the player-follow camera at ground height, pitch within interactive limits and a requested distance between 6 and 11 metres. Gear framing uses real right-drag input. The script checks that the camera target stays at the player's normal 1.1-metre follow height. It never calls the older documentation-oriented `focusPlayer` or `focusEntity` helpers.
