# Corealm — Phase 1 PRD

Scope: Phase 1 only. Content tiers 1, 5, 10 across three regions. The architecture must handle levels 1 to 99 and tiers 1 to 99 without schema changes, but no tier above 10 is authored in this run.

September 12, 2026 item-art amendment: [item icon rules](../../docs/item-icons.md) supersede every procedural or model-rendered inventory-icon instruction below. Generate and accept prompted item artwork first. Derive 3D assets from that artwork only where gameplay needs them; minor jewelry needs no dedicated model. The proposed [jewelry and stats revision](../jewelry-stats/PRD.md) records the separate gameplay changes awaiting approval.

Status: **Approved.** The project owner approved the gathering and production amendment below on August 30, 2026 by directing implementation of the complete plan. That directive satisfies the approval gate in `AGENTS.md`.

Everything here is meant to be implemented literally. Where a number appears, it is the number. Where a name appears, it is the name.

---

## Approved amendment: retire farming

The project owner approved this amendment on September 2, 2026 by directing removal of farming and
all farming-related quests. It supersedes every farming requirement elsewhere in this document.

- Farming is not a skill. The shipped game has 10 skills.
- Crop resources, seeds, farm plots, their interactions, growth state, audio cues, agent operations,
  and generated documentation are removed.
- Bright Water is removed because its objectives and rewards depend on farming. The shipped game has
  9 quests, including the 7-stage Long Cairn.
- Existing saves migrate to version 7. Migration removes retired farming state, skill and quest
  progress, and crop or seed stacks from inventory, bank, equipment, loot, and recovery caches.
- Ranger Syb remains as an ordinary NPC. Decorative produce and agrarian building props may remain
  where they do not expose farming gameplay.
- Crooked Grain remains: its objectives concern Woodcutting and the name refers to wood grain.

Acceptance requires typecheck, the full unit suite, production build, generated docs, feature-lab
gate, real-game Chromium smoke, and screenshot inspection. Regression tests must prove the public
contracts and authored world expose no farming and that version-6 saves migrate cleanly.

---

## Approved amendment: regional essence altar rites

The project owner approved this amendment on August 30, 2026 by directing the altar move, the Altar Ruins Free art swap, and the boss-Orb activation loop. It replaces the earlier rule that town altars only recharge weapons and that a crafting table consumes one Orb per elemental weapon.

- Fallowmarch, Vellenwood, and Karrowmoor each have one Essence Altar at their Air, Earth, or Water Essence Cache. The three town altars are removed.
- Each site uses the locally cached Altar Ruins Free package. The rectangular altar is the interactable station. A ruined stone court surrounds it, and the matching mineable Essence nodes ring the court.
- An altar starts dormant and emits no elemental light. The altar and full ruined court retain their authored stone detail with a readable region-appropriate base: worn pale limestone in Fallowmarch, light mossed forest stone in Vellenwood, and pale cold slate in Karrowmoor. A subtle hue shift still identifies the matching element.
- Every ruin sits on a fully leveled, locally paved stone court. The court clears trees, shrubs, grass, flowers, and loose litter beyond the structure and node ring; it never exposes a grass or dirt floor beneath the ruin.
- The imported ruin triangles participate in both physics and navigation. Players can walk on the circular platforms and through open arches, while columns, walls, debris, and the central monument remain solid and route paths around them.
- The matching region boss keeps its guaranteed Orb drop: the Tempest Roc drops Air, the Rootheart drops Earth, and Ordrun drops Water.
- Using the matching Orb on a dormant altar consumes the Orb, permanently awakens that altar in the save, and emits an `essence.altarAwakened` event. This boss, loot, travel, and awakening sequence is the region's altar mini quest.
- An awakened altar makes both matching elemental weapon types from their wooden base weapon. The Orb is the altar's one-time key and is not an input to each weapon. Air accepts Palewood, Earth accepts Duskoak, and Water accepts Cairnpine.
- Only an awakened altar can open its two weapon recipes or recharge a weapon. Recharge keeps the existing cost of 100 matching Essence and restores the weapon to 1,000 charges.
- Awakening deepens the full structure's element colour: pale cyan for Air, green for Earth, and slate blue for Water. The altar gains a sparse emissive channel, a second line below the tabletop, and a glowing circular emblem while the surrounding court keeps its weathered-stone texture under the stronger colour wash.
- Existing saves that already consumed an Orb awaken the matching altar during migration, so the amendment does not take progress away.

Acceptance requires focused state and migration tests, a production-backed feature-lab fixture proving dormant and awakened visuals plus the Orb interaction, and final-world Chromium proof at all three authored cache sites.

---

## Approved amendment: gathering and production foundation

This amendment replaces conflicting Phase 1 gathering, production, resource-presentation, and asset decisions elsewhere in this document. It keeps the current level 1, 5, and 10 materials, formulas, regions, node ids, quests, inventory rules, and production timings.

### Shared rules

- One canonical tier table owns the ore, fish, wood, intermediates, equipment ids, recipes, resource presentation, and asset references for levels 1, 5, and 10.
- Resource clusters reference a resource id and own only placement. Adding tiers 20 through 70 must not require a gathering or production system change.
- Resources use authored available and depleted presentations. An authored depleted asset outranks the clipped or desaturated fallback.
- `StationKind` includes `campfire`. Recipes list every accepted station. Cooking accepts `range` and `campfire`; other recipes keep one station.
- Saves move to version 3 and persist one temporary campfire against played time. Time spent with the game closed does not consume fuel.
- All imported art must be CC0 with source URL, pack id, license, and archive SHA-256 in the asset catalog. DEXSOFT's Rocks FREE pack is not allowed because its license is the Standard Unity Asset Store EULA.

### Mining and Smithing

- Gathering stays on the existing 1.8 second roll, success formula, tool bonus, 10/24/35 XP, depletion, and 21/32/43 second respawn schedule.
- Grithe and March Stone unlock at Mining 1, Corven at 5, and Kaldite at 10. Pale Quartz, Vell Amber, and Cairn Garnet remain the corresponding secondary drops.
- March Stone remains the flux for every bar. Grithe uses 1 ore plus 1 stone. Corven uses 2 ore plus 1 stone. Kaldite uses 2 ore plus 2 stone.
- Every metal tier produces a dagger, sword, helm, body, legs, boots, gloves, pickaxe, and hatchet. Metal weapons and tools use the matching wooden handle instead of a shaft.
- Ore nodes draw at roughly 1.4 to 1.8 metres wide. The source rock texture remains visible. Active nodes use thin embedded mineral fractures; depleted nodes keep the rock and show dark worked scars without a bright vein.

### Fishing and Cooking

| Level | Raw fish | Cooked food | Heal | Cooking XP |
| --- | --- | --- | ---: | ---: |
| 1 | Silt Minnow | Seared Minnow | 3 | 15 |
| 5 | Bramble Trout | Seared Trout | 7 | 36 |
| 10 | Cragfin | Seared Cragfin | 12 | 53 |

- Fishing uses the existing gather formulas. Active spots show deterministic fish below the canonical solved water surface with a restrained ripple. Depleted spots remove the fish and leave a faint recovery ripple.
- Fishing activity draws a tier-coloured rod, line, and bobber. Successful catches use the existing splash and fishing audio.
- Raw and burnt fish remain inedible. Cooked fish takes 1.8 seconds to eat and clamps healing at maximum health.
- Cooking keeps `clamp(0.45 - 0.030 * (Cooking level - recipe level), 0, 0.45)`. A range and campfire have identical recipe access and burn chance.
- If a campfire expires during a batch, completed fish remain and the next repetition consumes nothing.

### Woodcutting, Fletching, and Crafting

- Palewood unlocks at Woodcutting 1, Duskoak at 5, and Cairnpine at 10. The gather formulas do not change.
- Depleted trees use dedicated regular, mossy, and snow-touched stumps. Clipped tree geometry remains only as a missing-asset fallback.
- One log produces 4 shafts in 1.8 seconds for 10/24/35 Fletching XP.
- One log produces 2 stackable handles in 1.8 seconds for 10/24/35 Fletching XP. Each handle is worth 60 percent of its source log.
- Every tier produces a staff from 3 shafts plus 1 gem, a wand from 1 shaft plus 1 gem, a rod from 2 shafts plus 1 hide, a shield from 2 logs plus 1 bar, and a focus from 1 log plus 1 gem.
- Wands are main-hand Magic weapons at levels 1, 5, and 10. Their magic accuracy, magic power, and magic armour equal two-thirds of the corresponding staff values, rounded to whole numbers. They omit incidental melee power, keep the existing spell cadence, work with a focus, and cost 60 percent of the staff's value.
- The current Crafting ladder remains: essence shards, jewelry, robes, leggings, hoods, boots, and wraps.

### Temporary campfires

- A log inventory action builds a fire in 3 seconds. Completion consumes one log and awards both Fletching and Crafting XP. Interruption or invalid placement consumes nothing.
- The player may own one fire. A replacement removes the old fire only after the new build completes.
- The placement search starts about 1.5 metres ahead and stays inside interaction range. Valid ground is inside playable bounds, dry, no steeper than 15 degrees, and at least one metre clear of water, solids, buildings, and resource nodes.
- Log ownership is the only gate. Higher logs change lifetime and build XP, not cooking quality or recipe access.

| Log | Lifetime | Fletching XP | Crafting XP |
| --- | ---: | ---: | ---: |
| Palewood | 72 seconds | 2 | 2 |
| Duskoak | 120 seconds | 5 | 5 |
| Cairnpine | 180 seconds | 7 | 7 |

The formulas are `lifetimeSeconds = 60 + 12 * tier` and `buildXpPerSkill = round(gatherXp(tier) * 0.2)`.

### Asset selection

- Keep the shipped Quaternius trees, textured `rock_medium_1..3`, cooking pots, weapon meshes, audio, and procedural staff/rod icon work.
- Import `TreeStump`, `TreeStump_Moss`, `TreeStump_Snow`, `WoodLog`, `WoodLog_Moss`, and `WoodLog_Snow` from the locally cached Quaternius Ultimate Nature Pack.
- Import `Fish1`, `Fish2`, and `Fish3` from the locally cached Quaternius Animated Fish Pack and map them to minnow, trout, and cragfin.
- Compose the campfire from imported logs, existing small rocks, and the existing flame and smoke system. Extend procedural gear for wands and the held fishing rod.
- Keep Animated Cute Fish, Ultimate RPG, Survival, and Ultimate Stylized Nature documented as later CC0 candidates. Do not import them in this amendment.

### Acceptance

- Unit tests freeze the gather, production, healing, burn, campfire, migration, wand, and reference-integrity rules above.
- Chromium scenarios prove each level 1, 5, and 10 gather-to-production loop, every active/depleted/respawn transition, both cooking stations, fire replacement and expiry, and save/reload.
- Screenshot review covers active and depleted ore, trees, and fish at normal play distance plus the held wand, fishing rod, and campfire. The Highcairn scene stays within the existing 400 draw-call ceiling.

---

## Approved amendment: Phase 2 — Kilnhalt tier-20 expansion

The project owner approved this amendment on September 1, 2026 by directing implementation of the complete Kilnhalt tier-20 expansion plan. That directive satisfies the approval gate in `AGENTS.md`. It opens Phase 2 content: the fourth surface region, the tier-20 production row, the Fire element release, and four regional minibosses. Everything here is meant to be implemented literally.

### World extension

- The playable world extends north from `z = 200` to `z = 460`. Kilnhalt occupies the full existing width, `x = -350..350`: a 700 m × 260 m region on a 700 m × 660 m overall map. Fallowmarch, Vellenwood, Karrowmoor, and the Gravelmaw keep their current rectangles; Kilnhalt sits above both Fallowmarch and Vellenwood.
- The entire southern border at `z = 200` stays open. No gates, walls, portals, cliffs, or level checks block it; a player can walk into Kilnhalt at any x. Road guidance and multiple semantic route connections (adjacency and route nodes) cross the old northern edge, but physical traversal is open everywhere along the seam.
- Terrain blends continuously across the complete `z = 200` seam: no height cliffs, material snaps, or navmesh breaks. Kilnhalt is ember foothills: warm dark soil, dark rock, sparse burned woodland, its own climate field in the organic biome system, its own 8-swatch ground palette and architecture palette, regional scatter, ambience, and coastline. The coast collar, ocean plane, world map bounds, generated map renditions, and navmesh are regenerated for the new extents.
- `"kilnhalt"` joins `RegionId`. Every exhaustive region map is filled: persistence region validation, terrain character, region and architecture palettes, scatter, audio (footstep surface, ambience), map rendering, UI region labels, and asset preloading. Kilnhalt has region ambience; it ships no music until the owner-supplied library names a matching ember-foothills theme, exactly as Gravelmaw does.
- Full-world terrain, biome, coast, scatter, and map work is the documented lab-first exception. Reusable actors, structures, and equipment still take the lab-first path.

### Layout

| Feature | Position note | Contents |
| --- | --- | --- |
| Emberfast | Region centre, near `[0, 330]` | Settlement: bank, general store, smith shop, furnace, anvil, range, crafting table, fletching bench, respawn point |
| Clinker Quarry | West, near `[-250, 330]` | 6 Emberite ore nodes (tier 20), 2 Kilnstone nodes |
| Cinderpine Stand | East, near `[240, 340]` | 8 Cinderpine trees (tier 20) |
| Ashfin Springs | South-east, near `[210, 250]` | 4 fishing spots, Ashfin (tier 20) |
| Kilnhalt Altar Ruins | North-east, near `[290, 400]` | The Fire altar on its ruined court, 5 Fire Essence nodes ringing it |
| Cinderwake Arena | North-east, near `[286, 420]` | Cinderwake, the tier-20 miniboss |
| The Kilnroads | Open ground | Tier-20 enemy groups |

Roads link Emberfast to every named site and to route nodes on the Fallowmarch and Vellenwood sides of the old northern edge.

### Tier-20 gathering and production row

One `defineTier` row extends the canonical table; adding it must not require a gathering or production system change. Formulas are the existing ones: gather XP 52, node yields 7–14, respawn 65 s, tool bonus +17, level-20 requirements throughout.

| Role | Name | Id |
| --- | --- | --- |
| Ore / bar | Emberite | `emberite_ore`, `emberite_bar` |
| Flux | Kilnstone | `kilnstone` |
| Gem | Fire Opal | `fire_opal` |
| Wood | Cinderpine | `cinderpine_log`, `cinderpine_shaft`, `cinderpine_handle` |
| Hide | Charhide | `charhide` |
| Fish | Ashfin | `ashfin`, `seared_ashfin`, `burnt_ashfin` |
| Meat | Ember Haunch | `raw_ember_haunch`, `roast_ember_haunch`, `burnt_ember_haunch` |

- Smelting: one Emberite bar consumes 3 ore plus 2 Kilnstone, continuing the 1+1 / 2+1 / 2+2 escalation. Kilnstone is the tier-20 flux; March Stone remains the flux for tiers 1–10.
- Emberite produces the full metal set: dagger, sword, helm, plate, greaves, boots, gauntlets, pickaxe, hatchet, ring, pendant (`emberite_*`), using Cinderpine handles. Cinderpine produces staff, wand, rod, and shield; Charhide produces the magic set `charhide_hood/robe/leggings/boots/wraps`; magic jewellery is `cinder_ring` and `cinder_charm`. Stats follow the existing per-tier balance derivation in `content/equipment.ts` so that a full tier-20 melee kit lands near the PRD 2.4 checkpoint of +45 gearPower at level 20.
- Recipes generate from the existing craft-weight table (bar 42 XP, sword 182 XP, body 260 XP, cooked Ashfin 78 XP, and so on). Seared Ashfin heals 19.
- Cinderpine campfires burn 300 s and award 10 Fletching and 10 Crafting XP, from the existing formulas.
- Shops `emberfast_general` and `emberfast_smith` mirror the Highcairn pair at tier 20, including Fire Essence stocked locally like the other elements. Skill guides, icons, and equipment visuals extend automatically from the canonical row plus one icon appearance per new item and tier-20 entries in the tier-keyed icon tables.

### Fire release

- `fire` joins the released elements. `fire_essence`, `fire_orb`, `fire_wand`, and `fire_staff` become obtainable; the essence, Orb, altar, and charged-weapon tables gain their fire rows. `SpellElement`, the spell ids, and the frozen Magic 1–70 ladder do not change — Emberlash simply becomes castable once fire fuel exists.
- The Kilnhalt Altar Ruins follow the regional essence altar rites amendment exactly: an Altar Ruins Free court, dormant until the Fire Orb awakens it, ember-orange element wash when awakened, five matching Fire Essence nodes ringing the court. The awakened altar crafts `fire_wand` and `fire_staff` from Cinderpine base weapons and recharges fire weapons at the standard 100 Essence for 1,000 charges. The rare miniboss staves stay uncharged and never bypass this progression.
- The Fire Orb is a singleton: Cinderwake drops it at 100% until that Orb is owned or consumed, after which the existing duplicate-Orb suppression applies. Saves that already hold or consumed a Fire Orb awaken the Kilnhalt altar during migration, matching the other three elements.
- All obsolete "tier 15" fire copy — spellbook subtitles, contract comments, agent tool prose, spell-table headers — is corrected to tier 20. Save schema stays at version 6; the existing flexible maps carry the new region and items, validation extends to cover them, and old saves must load unchanged.

### Enemies

Tier-20 encounters use existing production creature paths (rig families already shipped) with new `*_t20` stat blocks: Ashback Bear, Cinder Boar, Emberhorn Ibex, Cinder Adder, and Kilnroad Reaver. Ordinary encounters balance to a 25–40 second kill for an on-tier player in tier-20 gear, and physical-versus-magic resistance differences stay meaningful: at least one family favours melee and one favours magic, in the spirit of PRD 2.4. Drops feed the tier-20 economy: Charhide and Ember Haunch from beasts, marks from all, purse marks from the Reaver.

### Minibosses

- An internal `miniBoss` placement flag joins enemy group authoring. A miniboss keeps the existing `"boss"` semantic archetype and the existing three-minute boss respawn, exposes `meta.rank: "miniboss"`, and renders at 1.3× authored scale. The three existing Orb bosses gain `meta.rank: "boss"` and are otherwise untouched; no existing boss is replaced.
- Four minibosses share the PixeliusVita Monster02 rig, built as four GLBs from one FBX using package texture variants, with canonical `Idle`, `Walk`, `Run`, `Attack`, `Hit`, and `Death` clips selected by named take:

| Miniboss | Tier | Region | Placement | Texture variant |
| --- | --- | --- | --- | --- |
| Galeskin | 1 | Fallowmarch | near `[-300, 145]` | 06 |
| Mossbound | 5 | Vellenwood | near `[318, 72]` | 02 |
| Tideworn | 10 | Karrowmoor | near `[18, -164]` | 05 |
| Cinderwake | 20 | Kilnhalt | near `[286, 420]` | 04 |

- Each miniboss independently rolls its named sword and its named staff at 10% each per kill (`galeskin_sword`/`galeskin_staff`, `mossbound_*`, `tideworn_*`, `cinderwake_*`). Requirements match the host region's tier. A rare sword copies the local craftable sword and applies `ceil(base × 1.10)` to accuracy and power; a rare staff applies the same rule to the local uncharged staff's offensive magic stats. Cinderwake additionally carries the Fire Orb drop above.
- All four actors and all eight rare weapons are proven in the production-backed feature lab — animation transitions, ground contact, grip sockets, clipping, scale, tint readability, icons, both body types — before world placement.

### Unity assets

Three locally cached Unity Asset Store packages are registered under their store provenance. No `.unitypackage` files or staging directories are committed; package and output SHA-256 values, authors, EULA position, source asset paths, dimensions, materials, textures, animations, and tags go into `UNITY_ASSET_SOURCES.md` and the asset manifest, following the existing ledger format.

| Package | Used asset |
| --- | --- |
| FREE - Low Poly Swords - RPG Weapons | `Sword15` — the one shared rare-sword geometry |
| FREE - Stylized Weapons | `Staff2_2_6` — the one shared rare-staff geometry |
| Fantasy Monster 3D Model 02 - Game Ready (PixeliusVita) | `Monster02_AllAnim.fbx` + texture variants 06/02/05/04 |

Per-item material tints apply through the production equipment and icon paths, not per-item geometry: Fallowmarch pale cyan, Vellenwood moss green and ochre, Karrowmoor cobalt and teal, Kilnhalt ember orange and crimson. The FBX conversion input gains an optional named-take selector so an all-animation FBX can emit canonical clips (`Attack01` → `Attack`, `GetHit` → `Hit`, `Die` → `Death`) instead of always taking `animations[0]`; requesting a missing take is a hard conversion failure.

### Out of scope

No dungeon, quest chain, new spell ids, ranged combat, or elemental melee-damage system. The Fire Orb-and-altar sequence is Kilnhalt's progression mini quest. The cached packages are authorized for this project under their recorded Unity Asset Store licenses. Routine screenshots, conversion staging, and browser reports stay ignored unless deliberately promoted as durable evidence.

### Acceptance

- Unit and integrity: region exhaustiveness, world bounds, deterministic content, item references, recipes, shops, resource presentations, equipment coverage, icons, manifest provenance, named-take extraction, required clips, root-motion removal, loop seams, stride measurements, independent seeded 10% loot rolls (neither / sword / staff / both), Fire Orb singleton custody, altar awakening, essence consumption, fire casting, charged-weapon production and recharge, tier-20 skill loops, combat target bands, save/reload in Kilnhalt, and backward save compatibility.
- Browser: cross the north seam at `x = -300, -150, 0, 150, 300` with continuous movement, navmesh paths, terrain height, and semantic region changes and no teleporting; gather and process every tier-20 resource; craft and equip both armour styles; kill Cinderwake, awaken the Fire altar, collect Fire Essence, cast a fire spell — comparing semantic state before and after each action; kill each regional miniboss and validate combat, animation, respawn, loot piles, equipment visuals, and persistence.
- Visual and performance: feature-lab screenshots of every Monster02 variant and weapon tint; final-world screenshots of the full northern band, the open border, Emberfast, the production sites, the Fire altar, normal combat, and the Cinderwake fight; regenerated world preview and map; typecheck, unit tests, build, docs, lab gate, creature gate, smoke, world checks, and the combined gate all green; 60 FPS target, 55 FPS floor, under 400 draw calls at 1920×1080 in Kilnhalt's densest view and the existing Vellenwood and Highcairn regression views.

---

## 0. Scope decisions

### In scope

All 10 skills, movement and camera, click-to-move over a real navmesh, keyboard movement, Rapier collision, semantic entities, 28-slot inventory, 9-slot equipment, bank, currency, shops, gathering with depletion and respawn, four production skills, melee and magic combat, enemies with three behaviours, loot, derived health, death and item recovery, NPCs, dialogue, 9 quests including one 7-stage chain, one dungeon, one boss, browser-local persistence, generated documentation, the WebMCP tool set, the agent event queue, four overlay kinds, and `window.__gameDebug`.

### Cut from Phase 1

These appear in the brief but do not serve the Phase 1 gate. Each is listed with where it goes.

| Cut | Reason | Where it goes |
| --- | --- | --- |
| Internal AI (Assist / Copilot / Autonomous modes) | The gate proves agent capability through an *external* AI over WebMCP. An in-game model integration adds a config panel, a key-handling problem, and a chat UI, none of which the gate checks. | Phase 2. `GameApi` is the seam it attaches to, so nothing gets rewritten. |
| Content tiers 20 to 99 | Phase 1 content scope is 1, 5, 10. | Phases 2 and 3. Content schemas carry `tier: number`, so no code changes. |
| Minimap | Needs a second render pass and its own art pipeline. A compass strip, world-space destination markers, and a Locations panel with click-to-path cover the same navigation need for a fraction of the cost. | Phase 2. |
| Boss phases beyond two, hazard fields, timing windows, resource-pressure mechanics | One boss with two phases and one telegraphed ground slam proves the telegraph system. More phases are content, not architecture. | Phase 2 and 3 bosses. |
| Bank tabs, fuzzy search, custom ordering, placeholders | A plain substring filter over item names covers every Phase 1 test case. | Phase 2. |
| Shop restocking simulation, price drift, stock decay | Fixed stock, fixed prices. The Phase 1 economy loop is sell-resources / buy-supplies, and drift makes tests non-deterministic for no gain across three regions. | Phase 2. |
| Overlay kinds beyond four (hazard markers, quest-target auto-tracking, requirement badges) | Highlight, path line, world marker, and world label cover the screenshot requirement and let an agent draw a complete assistant experience. | Phase 2. |
| Ranged combat, prayer-style systems, special attacks, multiple weapon styles | Not among the shipped skill set. | Never. |
| Day/night, weather, ambient audio, music | Not gate-checked, and each is a full system. | Phase 2 at the earliest. |
| Multiplayer, accounts, server persistence | The brief says browser-local for this roadmap. | Out of roadmap. |
| Item degradation, repair, charges (except magic essence shards) | No gate criterion. | Out of scope. |
| Paid or non-Quaternius assets, heavy VFX | Phase 1 is free Quaternius only, per the brief. | Phase 3. |

### Deliberate simplifications that need root sign-off

1. **No separate Defence skill.** The brief lists Melee as covering "physical accuracy, damage, defense", so physical defence level equals the Melee level and magical defence level equals the Magic level. Farming's retirement leaves the skill count at exactly 10.
2. **Death drops inventory only, not equipment.** The brief asks for consequence while keeping experimentation practical. Dropping worn gear makes the agent recovery loop much harder to test and much harsher for new players. Equipment stays worn through death.
3. **Magic needs a consumable.** Attack spells consume one Essence Shard per cast. Without a cost, magic beats melee at every tier because it has no upkeep. Shards come from Crafting (gem plus log) and from shops, which wires Magic into Mining and Crafting.

### Approved scope amendment: audio

The August 29, 2026 audio brief reverses the Phase 1 cut for ambient audio and music. The shipped game now includes:

- A rights-traced SFX library plus owner-supplied local music, curated to Corealm's grounded medieval-fantasy tone. Files that read as modern, sci-fi, cartoon, firearm, vehicle, electronic, or otherwise outside that tone are excluded.
- SFX for player footsteps and every shipped interaction family: mining, woodcutting, fishing, smithing, smelting, crafting, cooking, fletching, melee, magic, damage, death, looting, doors, portals, agility, equipment, banking, shops, dialogue, and UI feedback.
- Repeated cue variants play in a fixed round-robin order at a fixed playback rate. Footsteps read the rendered ground material, with distinct families for grass, dirt and mud, stone and gravel, wood, forest floor, and cave floor.
- Region ambience for the three surface regions and the Gravelmaw interior. Ambience changes with semantic player region and never changes game state.
- Region music only where the supplied `C:\Users\Borg\Music\corealm` library names a shipped region theme. Fallowmarch uses plains music, Vellenwood uses `Deep Woodland`, Karrowmoor uses `Stone city`, and Gravelmaw has no music until a matching track is supplied. Desert, jungle, goblin-village, mire, and swamp tracks are reserved for future regions.
- Three independently persisted client volumes, `music`, `ambient`, and `sfx`, exposed in an Audio section reachable from the main menu. Each control applies immediately and supports a true zero-volume state.
- Browser acceptance that proves audio unlocks after a user gesture, region changes select the right ambience and eligible music, representative semantic actions select the right cue family, zero volume silences its own bus, settings survive reload, and no audio error reaches the console.

---

## 1. Player experience and core loop

### The fifteen-second read a new player forms

You wake on a windy plain outside a walled town that is obviously the last safe thing for miles. Rocks glint. Trees are clearly choppable. Something small and hostile is picking through the grass forty metres off. Everything visible can be taken, hit, or walked to.

### Core loop

```
explore -> gather -> produce -> equip / consume -> fight or quest -> level up
       -> unlock a stronger tier or a shorter route -> explore further
```

The loop closes on itself twice, and both must be visible to the player.

**Material loop.** Ore and logs become bars and handles, which become weapons and tools, which make gathering and combat faster, which produce more ore and logs.

**Route loop.** Agility levels open shortcuts that shorten bank trips, which raises XP per hour on distant high-tier nodes, which flips which node is actually the best training spot. Section 2.8 gives the exact numbers for that flip.

### Session shapes

| Session | Length | What the player does |
| --- | --- | --- |
| First | 20 to 40 min | Spawn in Fallowmarch, take Cold Iron, mine Grithe, smelt, smith a dagger, kill Rill Skitterlings, reach Melee 5 and Mining 5. |
| Mid | 30 to 60 min | Travel to Vellenwood, train Woodcutting and Fishing on tier 5, cook, run the Canopy Run agility route, fight Thornbound. |
| Late Phase 1 | 60 to 120 min | Karrowmoor. Tier 10 gear, the Sunder Ledge shortcut, The Long Cairn chain, then Ordrun. |

### What "readable" means concretely

- A node's tier is legible from 12 m at the default camera pitch, by material colour and by silhouette scale.
- Right-clicking anything lists every interaction it has. Unavailable entries stay visible, greyed, and state the missing requirement in plain text ("Requires Mining 10").
- Every XP gain floats a number in the skill's colour, and the skill guide panel states the exact XP for every action the player has performed at least once.

### Agent experience

An agent gets the same world through 16 WebMCP tools (section 7.4). It cannot teleport, cannot read undiscovered content, and moves at 4.2 m/s over the navmesh a human walks. Two things make agent quality measurable. The event queue means a good agent almost never polls. The route flip in section 2.8 means a naive "always mine the highest tier" agent gives up roughly 15% XP per hour against an agent that does the arithmetic.

---

## 2. Mechanics with numerical values

### 2.1 The XP curve

One closed-form formula, computed once at load into a frozen 99-entry table.

```
totalXpAt(L) = floor( 873 * (1.1 ^ (L - 1)) - 873 + 6 * L * (L - 1) )
```

`totalXpAt(1) = 0`, and `xpToNext(L) = totalXpAt(L + 1) - totalXpAt(L)`.

Checkpoints, all derived from that formula. The root can verify any row with a calculator.

| Level | Cumulative XP | XP for that level |
| --- | --- | --- |
| 2 | 99 | 99 |
| 3 | 219 | 120 |
| 5 | 525 | 165 |
| 10 | 1,725 | 295 |
| 20 | 6,746 | 714 |
| 30 | 18,195 | 1,607 |
| 40 | 44,406 | 3,734 |
| 50 | 106,992 | 9,057 |
| 60 | 262,014 | 22,676 |
| 70 | 654,878 | 57,807 |
| 80 | 1,662,731 | 148,737 |
| 90 | 4,263,794 | 384,396 |
| 92 | 5,151,454 | 464,919 |
| 95 | 6,843,596 | 618,482 |
| 98 | 9,094,836 | 822,861 |
| 99 | **9,999,879** | 905,043 |

Level 99 lands 121 XP under 10 million, which is as close as a clean two-constant formula gets. Level 92 sits at 51.5% of the total, so the last seven levels are half the grind, which is the pacing classic-MMO players expect. Increments are strictly positive at all 98 steps. Level 2 at 99 XP is small enough that a new player levels something inside the first minute.

The table is canonical content data. `content/xp.ts` computes it at module load and exports a frozen `readonly number[]` of length 99. Nothing else may recompute it.

Phase 1 imposes no level cap. A player can grind Mining to 40 on tier 10 nodes if they want. Content simply stops at tier 10.

### 2.2 Skills

Exactly 11, each 1 to 99, each starting at level 1 with 0 XP.

| Id | Name | Group | Colour (XP drops and skills panel) |
| --- | --- | --- | --- |
| `melee` | Melee | combat | `#c0392b` |
| `magic` | Magic | combat | `#5b6ee1` |
| `mining` | Mining | gathering | `#8d8d94` |
| `woodcutting` | Woodcutting | gathering | `#6b8f3a` |
| `fishing` | Fishing | gathering | `#3aa0c4` |
| `smithing` | Smithing | production | `#b5651d` |
| `crafting` | Crafting | production | `#a86fc4` |
| `cooking` | Cooking | production | `#d98c2b` |
| `fletching` | Fletching | production | `#7a5c3a` |
| `agility` | Agility | utility | `#3ac48a` |

Health is derived, not a skill.

### 2.3 Derived health

```
vitalityLevel = max(1, floor((melee + magic) / 2))
maxHealth     = 20 + 3 * vitalityLevel + sum(equipped.vitality)
```

| Melee / Magic | Equipment vitality | Max health |
| --- | --- | --- |
| 1 / 1 | 0 | 23 |
| 10 / 1 | +6 (tier 1 kit) | 41 |
| 12 / 5 | +14 (tier 5 kit) | 58 |
| 18 / 8 | +16 (tier 10 kit) | 75 |
| 50 / 50 | +40 | 210 |
| 99 / 99 | +90 | 407 |

Out of combat, health regenerates 1 point every 6.0 s. Regeneration stops while any hostile has targeted the player within the last 8 s.

### 2.4 Combat formulas

All rolls resolve on the combat tick, which is 600 ms. A weapon with speed 2.4 s attacks every 4 combat ticks.

**Accuracy.**

```
attackRoll  = (attackLevel  + 9) * (1 + gearAccuracy / 100) * styleFactor
defenceRoll = (defenceLevel + 9) * (1 + gearArmour   / 100)
hitChance   = clamp(attackRoll / (attackRoll + defenceRoll), 0.05, 0.95)
```

For melee, `attackLevel` is the attacker's Melee, `styleFactor` is 1.00, and the defender uses Melee as `defenceLevel` plus the sum of `armour` on worn gear. For magic, `attackLevel` is the attacker's Magic, `styleFactor` is 1.15, and the defender uses Magic plus the sum of `magicArmour`.

Enemies carry `attackLevel`, `defenceLevel`, `accuracy`, `armour`, and `magicArmour` in content data, so the same two lines cover both directions.

**Melee damage.**

```
maxHit = floor(2 + (meleeLevel + gearPower) / 4.2)
damage = hit ? randomInt(1, maxHit) : 0
```

| Melee level | gearPower | maxHit |
| --- | --- | --- |
| 1 | 0 (unarmed) | 2 |
| 1 | +6 (Grithe dagger) | 3 |
| 5 | +14 (Corven sword) | 6 |
| 10 | +26 (Kaldite sword) | 10 |
| 20 | +45 | 17 |
| 50 | +110 | 40 |
| 99 | +200 | 73 |

A miss deals 0. A hit deals at least 1, which reads better than the classic zero-damage-hit and gives agents a cleaner signal.

**Magic damage.** Each spell carries `baseMax` and `divisor`.

```
maxHit = floor(spell.baseMax + (magicLevel + gearMagicPower) / spell.divisor)
```

| Spell | baseMax | divisor | maxHit at unlock | maxHit 10 levels later with tier gear |
| --- | --- | --- | --- | --- |
| Emberlash (Magic 1) | 3 | 8 | 3 | 6 |
| Stonebrand (Magic 5) | 5 | 7 | 6 | 9 |
| Voltrend (Magic 10) | 8 | 6 | 14 | 18 |

Magic is slower (3.0 s per cast against 2.4 s for a standard sword) and costs one Essence Shard per cast, but it is 15% more accurate through `styleFactor`. Its niche is high-`armour`, low-`magicArmour` targets. Against a Cairnwight (armour +55, magicArmour +10) at Magic 10 with a Kaldite staff, Voltrend kills in 24 s where a Kaldite sword at Melee 12 takes 33 s. Against a Scree Skitterling (armour +30, magicArmour +40) melee wins. Both paths stay useful, which is a gate criterion.

**Combat XP.**

```
xpPerDamage = 4                                  // to melee or magic, whichever dealt it
onKill:   attackerSkillXp += round(target.maxHealth * 2.0)
onCast:   magicXp += spell.baseXp                // 5 / 12 / 22 at tier 1 / 5 / 10, hit or miss
```

Melee 1 to 10 needs 1,725 XP. A Rill Skitterling has 6 HP and gives 6 * 4 + 12 = 36 XP, so 48 kills, roughly 11 minutes with a tier 1 dagger. At Melee 99 with +200 gear the rate is about 133,000 XP/hr, so 99 costs roughly 75 hours of pure combat.

**Time to kill, verified against the formulas above.**

| Fight | Hit chance | maxHit | TTK |
| --- | --- | --- | --- |
| Melee 1 unarmed vs Rill Skitterling (6 HP) | 50% | 2 | 19 s |
| Melee 3, Grithe dagger vs Rill Skitterling | 56% | 4 | 10 s |
| Melee 7, Corven sword vs Thornbound Husk (26 HP) | 51% | 7 | 30 s |
| Melee 12, Kaldite sword vs Scree Skitterling (34 HP) | 51% | 11 | 27 s |
| Melee 12, Kaldite sword vs Cairnwight (38 HP) | 46% | 11 | 33 s |
| Melee 18, tier 10 kit vs Ordrun (200 HP) | 45% | 12 | 165 s |

Ordrun deals about 1.02 damage/s through tier 10 armour, so a 165 s fight costs roughly 169 damage against a 75 HP pool. That is about 9 Seared Cragfin (11 HP each) plus eat time. A boss you can lose is the point.

**Auto-attack.** Starting an attack sets `combat.targetId`, and the player keeps attacking on the weapon's cadence until the target dies, the player leaves the 1.6 m melee or 9.0 m spell range, the player issues another command, or the player dies. Enemies use a content-defined aggro radius of 6 m to 14 m and leash at 28 m from their spawn point.

### 2.5 Gathering formulas

One shared model across Mining, Woodcutting, and Fishing.

```
gatherTickMs   = 1800
effectiveLevel = skillLevel + tool.gatherBonus
successChance  = clamp(0.30 + 0.016 * (effectiveLevel - node.reqLevel), 0.05, 0.95)
yieldXp(tier)  = round(10 * tier ^ 0.55)
```

At the node's own requirement level the chance is exactly 0.30, which is 6.0 s per yield. It reaches 0.95 at 41 levels above the requirement. The formula is deliberately tier-independent so an agent can reason about it in one line.

Tools add flat effective levels: tier 1 tool +2, tier 5 tool +5, tier 10 tool +9. General rule for later tiers, `toolBonus(tier) = round(1.6 + 0.75 * tier)`, capped at 40. Attempting a node without the required *base* skill level is refused with `REQUIREMENTS_NOT_MET`. Tools never bypass requirements.

| Tier | yieldXp | XP/hr at exactly the req level | XP/hr at req+10 |
| --- | --- | --- | --- |
| 1 | 10 | 6,000 | 8,880 |
| 5 | 24 | 14,400 | 21,300 |
| 10 | 35 | 21,000 | 32,200 |
| 20 | 52 | 31,200 | 47,800 |
| 50 | 86 | 51,600 | 79,100 |
| 99 | 125 | 75,000 | 115,000 |

Those are gather-only rates. Real rates run 25% to 40% lower once bank trips count, which is what makes section 2.8 interesting.

Mining 1 to 10, switching to tier 5 ore at Mining 5, takes 9.4 minutes of pure gathering, or about 13 minutes with travel and one bank trip. That is the time budget for the external-agent Mining proof.

### 2.6 Node durability and respawn

```
yieldRange(tier)     = [ max(4, round(9  - 0.052 * tier)),
                         max(8, round(15 - 0.052 * tier)) ]
respawnSeconds(tier) = round(18 + 3.2 * tier ^ 0.9)
```

| Tier | Yields per life | Respawn |
| --- | --- | --- |
| 1 | 9 to 15 | 21 s |
| 5 | 9 to 15 | 32 s |
| 10 | 8 to 14 | 43 s |
| 50 | 6 to 12 | 126 s |
| 99 | 4 to 10 | 218 s |

Yield count is rolled from the seeded RNG when a node respawns. A depleted node swaps to its depleted mesh variant and desaturates its material by 45%.

Cluster sizing keeps circuits alive. Five nodes at roughly 12 yields each at 6.0 s per yield is 360 s of work against a 21 s to 43 s respawn, so node 1 is always back before node 5 empties. The tension only appears at high skill levels or with a small cluster, and both are used on purpose: the 3-node Kaldite seam in Upper Karrow genuinely runs dry at Mining 20+, which is what pushes players to the second seam and the shortcut.

### 2.7 Production formulas

```
recipeXp = round(yieldXp(tier) * craftWeight)
```

| Recipe kind | craftWeight | Duration | Skill |
| --- | --- | --- | --- |
| Smelt bar | 0.8 | 2.4 s | Smithing |
| Dagger | 2.0 | 3.0 s | Smithing |
| Sword | 3.5 | 3.0 s | Smithing |
| Body or legs armour | 5.0 | 3.0 s | Smithing |
| Helm, boots, gloves | 2.5 | 3.0 s | Smithing |
| Pickaxe or hatchet head | 2.2 | 3.0 s | Smithing |
| Cooked food | 1.5 | 2.4 s | Cooking |
| Essence shard (yields 5) | 1.2 | 2.4 s | Crafting |
| Amulet or ring | 3.0 | 2.4 s | Crafting |
| Leather body | 4.0 | 2.4 s | Crafting |
| Staff | 3.2 | 1.8 s | Fletching |
| Tool handle | 1.0 | 1.8 s | Fletching |
| Fishing rod | 1.8 | 1.8 s | Fletching |
| Wooden shield | 2.8 | 1.8 s | Fletching |

Worked examples. Tier 1 `yieldXp` is 10, so a Grithe bar gives 8 XP and a Grithe sword gives 35 XP. Tier 10 `yieldXp` is 35, so a Kaldite bar gives 28 XP and a Kaldite body gives 175 XP.

Cooking is the only production skill that can fail:

```
burnChance = clamp(0.45 - 0.030 * (cookingLevel - recipe.reqLevel), 0.00, 0.45)
```

Burning stops 15 levels above the requirement. Burnt food gives 0 XP and a worthless item.

Batch jobs run `quantity` repetitions back to back and stop on missing ingredients, a full inventory, player movement, damage taken, or cancel.

**Food healing.**

```
healAmount(tier) = round(2 + 1.35 * tier ^ 0.85)
```

Tier 1 heals 3, tier 5 heals 7, tier 10 heals 11, tier 99 heals 70. Eating takes 1.8 s and blocks attacks for that time. Healing above `maxHealth` is wasted.

### 2.8 Agility and the route-optimisation flip

```
agilityXp(tier) = round(10 * tier ^ 0.55 * 1.8)     // 18 / 43 / 63 at tier 1 / 5 / 10
successChance   = clamp(0.60 + 0.02 * (agilityLevel - obstacle.reqLevel), 0.50, 1.00)
onFail:         damage = randomInt(2, 6), player placed at obstacle.failPoint, no XP
```

Traversal takes 2.0 s to 4.0 s depending on the obstacle. Success reaches 1.00 twenty levels above the requirement.

The flip case, with real numbers. Run speed 4.2 m/s, 28-slot load, 6 s of bank interaction per trip, 1.8 s gather tick.

| Mining level | Corven seam, 38 m from Rootfall bank | Kaldite seam, 190 m from Highcairn bank | Same Kaldite seam via **Sunder Ledge** (Agility 10), 45 m plus a 6 s climb |
| --- | --- | --- | --- |
| 12 | 16,522 XP/hr | 14,210 XP/hr | 18,448 XP/hr |
| 15 | 18,100 XP/hr | 15,399 XP/hr | 20,504 XP/hr |
| 20 | 20,601 XP/hr | 17,123 XP/hr | 23,679 XP/hr |

Before Agility 10, tier 5 ore next to a bank beats tier 10 ore across the moor by about 16%. After Agility 10, tier 10 wins by about 12%. That reversal is the metagame the brief asks for, and any agent that can multiply will find it.

Phase 1 has 9 obstacles: 2 in Fallowmarch (req 1 and 3), 3 in Vellenwood (req 5, 6, 8), 4 in Karrowmoor (req 10 for Sunder Ledge, plus 12, 14, 14).

### 2.9 Inventory, bank, currency

- Inventory: 28 slots. Stackable kinds are currency, essence shards, shafts, and gems. Everything else takes one slot per item, including every ore, log, fish, bar, and equipment piece.
- Bank: 400 slots, every slot stacks to 2,147,483,647. Deposit, withdraw, deposit-all, quantity selection (1 / 5 / 10 / all / custom), and a substring name filter.
- Currency: **marks**. Stackable, carried in inventory, dropped by enemies, paid by quests, earned by selling.

Reference prices. Shop buy price to the player and sell price from the player, at a 40% spread.

| Item | Buy | Sell |
| --- | --- | --- |
| Grithe ore | 12 | 7 |
| Corven ore | 42 | 25 |
| Kaldite ore | 95 | 57 |
| Palewood log | 10 | 6 |
| Duskoak log | 38 | 22 |
| Cairnpine log | 88 | 52 |
| Grithe sword | 180 | 108 |
| Corven sword | 620 | 372 |
| Kaldite sword | 1,450 | 870 |
| Essence shard | 9 | 5 |
| Seared Cragfin | 70 | 42 |

Enemy mark drops are `randomInt(round(tier * 3), round(tier * 11))`, so tier 1 drops 3 to 11 and tier 10 drops 30 to 110. Ordrun drops 900 to 1,400 plus a guaranteed Kaldite piece.

### 2.10 Death and recovery

On death, every inventory item drops into a **Recovery Cache** semantic entity at the death position, snapped to the navmesh. Equipped items stay equipped. No XP or levels are lost. The player respawns at the last settlement respawn point they have visited (Coldbrace, Rootfall, or Highcairn) at full health.

The cache is visible only to its owner, survives reload, and expires 15 real minutes after creation. Expiry destroys the contents. Only one cache exists at a time, and dying with a live cache destroys the old one, so the HUD shows a persistent warning banner with a countdown while a cache is live.

Opening an enemy loot pile or Recovery Cache is read-only. It opens a compact inventory grid beside the world container with exactly one cell per remaining stack and no filler cells. Nothing moves into the player's inventory until that stack is clicked. The container remains in the world until every stack has been taken or it expires.

Movement speed is 4.2 m/s running and 1.9 m/s walking. Walking is used only by NPCs.

---

## 3. Runtime systems and update order

### Frame structure

The game runs a fixed-step simulation inside a variable-rate render loop. Two clocks:

- **Sim tick:** 100 ms fixed step. Up to 5 sim steps per frame, then the accumulator clamps to avoid spiral-of-death after a tab restore.
- **Combat / gather tick:** 600 ms, counted in sim ticks (every 6th sim step). All combat rolls, gather rolls, and production completions land here so results are reproducible from a seed and a tick count.

`__gameDebug.step(ms)` drives sim ticks manually while paused, which is how Playwright gets determinism.

### Update order inside one sim tick

Order is load-bearing. A worker who reorders this breaks tests.

| # | System | Owner file | What it does |
| --- | --- | --- | --- |
| 1 | Time | `core/time.ts` | Advances `simTimeMs`, applies `timeScale`, emits tick boundaries. |
| 2 | Input intake | `input/*` | Drains queued human intents into the same command queue the agent API writes to. |
| 3 | Command dispatch | `api/gameApi.ts` | Validates and applies one command per actor per tick. Rejections become errors and events. |
| 4 | Navigation | `systems/navigation.ts` | Advances path following, recomputes on blockage, emits `navigation.completed` / `navigation.failed`. |
| 5 | Physics | `systems/physics.ts` | Rapier step. Character controller resolves collision and grounding for the player and all enemies. |
| 6 | Activity | `systems/gathering.ts`, `production.ts`, `agility.ts` | Advances the single active player activity. Rolls only on combat ticks. |
| 7 | Enemy AI | `systems/enemyAI.ts` | Aggro checks, leash checks, chase, retreat, boss phase transitions and telegraphs. |
| 8 | Combat | `systems/combat.ts` | Resolves attack timers for the player and every engaged enemy, applies damage, awards XP. |
| 9 | Health | `systems/health.ts` | Regeneration, low-health threshold crossing, food effects. |
| 10 | Death | `systems/death.ts` | Detects zero health, builds the Recovery Cache, teleports and resets. Also expires stale caches. |
| 11 | World | `world/entities.ts` | Node respawn timers, loot despawn, spawner repopulation. |
| 12 | Quests | `systems/quests.ts` | Evaluates stage predicates against the state snapshot, advances stages, emits `quest.updated`. |
| 13 | Discovery | `api/observation.ts` | Marks newly visible entities and locations as discovered, emits `entity.discovered`. |
| 14 | Event flush | `agent/events.ts` | Appends the tick's events to the ring buffer, wakes any blocked `corealm_events` waiters. |
| 15 | Persistence | `persistence/storage.ts` | Marks state dirty. Autosave writes at most once every 10 s, and always on `beforeunload`. |

### Render frame, after the sim catches up

| # | Step | Owner file |
| --- | --- | --- |
| R1 | Camera update, follow and collision | `render/camera.ts` |
| R2 | Entity view sync (position, state, material variant) | `render/entityViews.ts` |
| R3 | Character animation blend | `render/characterRig.ts` |
| R4 | Overlay rebuild (highlights, path lines, markers, labels) | `render/overlays.ts` |
| R5 | Damage numbers, XP drops, hit sparks | `render/vfx.ts` |
| R6 | Three.js render | `render/renderer.ts` |
| R7 | UI reconciliation from the state snapshot | `ui/*` |

Renderers read state. They never write it. The one exception is `render/camera.ts`, which owns `camera` in the settings slice because it has no gameplay meaning.

### Determinism

- Every gameplay random draw goes through `core/rng.ts`, a seeded xorshift128+ with named streams (`combat`, `gather`, `loot`, `worldgen`, `ai`). Streams are independent so a combat roll never shifts a scatter placement.
- `worldgen` is seeded from the region seed and is stable across reloads. The other streams seed from the save and persist their counters.
- `Math.random` is banned in `game/src/` outside `core/rng.ts`. Add an ESLint `no-restricted-properties` rule.

### Boot sequence

1. Parse and validate all content (`content/validate.ts`). A schema failure throws before the renderer exists, with the offending id in the message.
2. Build the XP table and freeze it.
3. Create renderer, scene, camera, and the loading screen.
4. Load the asset manifest and the GLB set for the spawn region only. The other two regions stream in on approach.
5. Init Rapier, build static colliders from region collision meshes.
6. Load or build navmeshes with recast-navigation. Baked `.bin` navmeshes ship in `game/public/nav/`, with runtime bake as the fallback.
7. Restore the save, or create a new character.
8. Construct semantic entities for the spawn region, then instantiate their views.
9. Install `window.__gameDebug`, then register the WebMCP tool set.
10. Set `__gameDebug.ready()` to true and start the loop.

Target: `ready()` returns true within 6 s on a cold cache, 2 s warm.

### Performance budget

60 FPS on a modern gaming desktop at 1920x1080. Per frame budget of 16.6 ms, allocated as 6 ms render, 3 ms sim, 2 ms UI, 5 ms headroom. Enforcement rules:

- One `InstancedMesh` per (asset, material variant) pair for scatter props. Target under 400 draw calls in the densest view, which is Vellenwood canopy.
- Entity views instantiate only within 140 m of the camera, with a 160 m destruction hysteresis.
- Two LOD levels per Quaternius mesh above 500 triangles, swapping at 45 m.
- Shadow map is a single 2048 cascade covering 60 m around the player.
- `__gameDebug.getMetrics()` reports `fps`, `frameMs`, `drawCalls`, `triangles`, `entityCount`, and `heapMB`, so screenshot runs can assert the budget.

---

## 4. World layout and visual direction

### Naming direction for all twelve regions

So later phases stay consistent, the naming system is fixed now.

Rules. One invented compound word from Old-English or Anglo-Saxon roots. Two or three syllables. No apostrophes, no `-ia` or `-oria` suffixes, no real-world place names, no Latinate abstractions. Tiers 1 to 30 use land nouns (march, wood, moor, halt, mire). Tiers 40 to 70 blend land nouns with weather and element roots. Tiers 80 to 99 drop the land-noun grammar entirely and use element or abstract roots. The Core is the only region named with a definite article, which is how the player knows it is the last one.

| Tier | Direction | Reserved name |
| --- | --- | --- |
| 1 | Frontier plains | **Fallowmarch** (Phase 1) |
| 5 | Deep woodland | **Vellenwood** (Phase 1) |
| 10 | Stone highlands | **Karrowmoor** (Phase 1) |
| 20 | Ember foothills | Kilnhalt |
| 30 | Marshlands | Sedgemire |
| 40 | Frozen north | Rimewatch |
| 50 | Desert | Sunderwaste |
| 60 | Storm coast | Gallowtide |
| 70 | Corrupted wilds | Blightholt |
| 80 | Volcanic wastes | Ashvarr |
| 90 | Arcane / astral | Aetherfall |
| 99 | The final realm | The Core |

Material names follow the same escalation: Grithe, Corven, Kaldite (Phase 1), then Emberite, Fenglass, Rimesteel, Sunderite, Tidewrought, Blightsteel, Ashvarrite, Aetherite, Corestone.

### Fallowmarch (tier 1, frontier plains)

Fallowmarch is the last surveyed land before the maps stop being useful. Two generations ago the March Company drove a road north from somewhere nobody here has been, planted a bank vault at the end of it, walled a town around the vault, and then stopped answering letters. What is left is Coldbrace: a stone-and-timber town of about two hundred people who make their living pulling soft grey Grithe out of a shallow pit, selling it back down the road, and pretending the wind off the northern moor does not sound like anything. The plains themselves are open, tussocky, and easy. Nothing here will kill a careful person. That is exactly why people who want to be careful stay, and why everyone interesting has already left for the woods.

**Layout.** 420 m x 420 m playable, elevation range 14 m, gentle rolling terrain with a north-south road spline.

| Feature | Position note | Contents |
| --- | --- | --- |
| Coldbrace town | Centre-south, walled, two gates | Bank (12 counter slots visually, one shared 400-slot store), General shop, Smith shop, furnace and anvil, cooking range, crafting table, fletching bench, 5 quest NPCs |
| Bracken Pit | 160 m north of town | 6 Grithe ore nodes (tier 1), 2 stone nodes |
| Palewood Copse | 190 m west | 8 Palewood trees (tier 1) |
| Redsill Shallows | 120 m east, on Corven Brook | 4 fishing spots, Silt minnow (tier 1) |
| Marchfield | 90 m north-east, inside the wall line | Abandoned March Company fieldworks and a route landmark |
| The Open March | Everywhere outside the road | Rill Skitterlings, Marchwolf pups |
| Brookvault Planks (Agility 1) | Across Corven Brook | Cuts the bank-to-Redsill trip from 205 m to 130 m |
| Wall Vault (Agility 3) | North wall | Cuts bank-to-Bracken from 178 m to 118 m |
| North Gate | Top of the road | Exit to Vellenwood |

**Look.** Bleached grass greens, weathered grey-brown timber, a single warm accent of copper-orange on Coldbrace roofs. Wide sightlines, low prop density (about 1 prop per 40 m²). The player can see the town from anywhere on the plain, which is the point.

**Landmarks:** the March Company vault tower (tallest structure, visible from 300 m), the broken north milestone, the lone dead Palewood at the top of the rise.

### Vellenwood (tier 5, deep woodland)

Vellenwood grows out of the north end of Fallowmarch the way a wall grows out of a fence. Within two hundred metres of the gate the sky closes. The Duskoak here are old enough that the March Company surveyors marked them as terrain rather than trees, and the ground between them is a slow tangle of root, moss, and standing water that is deeper than it looks. Rootfall is the only settlement: nine buildings and a bank chest, built on and around the stump of a Duskoak so large the stump is the town square. The people of Rootfall are cheerful in a way that people who live somewhere genuinely dangerous often are. They will tell you which paths are safe. They will not tell you why the Thornbound only move at the edges of the clearings, and they will change the subject if you ask twice.

**Layout.** 380 m x 380 m, elevation range 26 m, a river gorge cutting north-west to south-east, canopy occlusion is the primary navigation problem.

| Feature | Contents |
| --- | --- |
| Rootfall hamlet | Bank chest, general shop, cooking range, anvil, 3 quest NPCs |
| Duskoak Stand | 10 Duskoak trees (tier 5) |
| Hollowcut Seam | 5 Corven ore nodes (tier 5), 38 m from the Rootfall bank chest |
| Blackwater Pools | 5 fishing spots, Bramble trout (tier 5) |
| The Thornline | Thornbound Husks, Bramble Skitterlings, Marchwolves |
| Fallen Duskoak (Agility 5) | Gorge crossing, saves 85 m |
| Canopy Walk (Agility 6) | Three-platform route above the stand |
| Root Tunnel (Agility 8) | Rootfall to the Thornline, saves 110 m |
| South and East gates | Fallowmarch and Karrowmoor |

**Look.** Deep desaturated greens with a strong value contrast between shafted light and canopy shadow. Bark browns pushed purple. High prop density (about 1 per 8 m²) but ground clutter is kept low so pathing stays legible. Fog starts at 55 m.

**Landmarks:** the Rootfall stump, the split Duskoak over the gorge, the standing stones at the Thornline edge.

### Karrowmoor (tier 10, stone highlands)

Karrowmoor is what Fallowmarch would be if you tilted it sixty degrees and took the soil away. The moor climbs in terraces of grey slate to a ridge you can see from the Vellenwood gate, and every flat surface on it is covered in cairns. Nobody in Highcairn built them and nobody in Highcairn will move one. The outpost itself is a quarry camp with a wall, kept alive by the fact that Kaldite is the hardest metal anyone this side of the road has a name for, and by the fact that the quarry crew stopped digging six months ago. What they hit was the Gravelmaw, and what came out of the Gravelmaw is still walking around inside it, arranging stones. The crew calls it Ordrun. They have a rota for who watches the entrance, and they have never once discussed sealing it.

**Layout.** 460 m x 460 m, elevation range 62 m across four terraces, verticality is the defining feature.

| Feature | Contents |
| --- | --- |
| Highcairn outpost | Terrace 2. Bank, general shop, smith shop, furnace, anvil, cooking range, 4 quest NPCs |
| Lower Quarry | Terrace 1. 5 Kaldite ore nodes (tier 10), the Gravelmaw entrance |
| Upper Karrow Seam | Terrace 4. 3 Kaldite ore nodes, 190 m from the bank by road |
| Ridge Pines | Terrace 3. 8 Cairnpine trees (tier 10) |
| Cairn Tarns | Terrace 2 and 3. 4 fishing spots, Cragfin (tier 10) |
| The Cairnfields | Cairnwights, Scree Skitterlings, Thornbound Elders |
| **Sunder Ledge** (Agility 10) | Highcairn to Upper Karrow. 190 m becomes 45 m plus a 6 s climb. This is the flip in section 2.8. |
| Scree Slide (Agility 12) | Terrace 4 down to terrace 1, one-way |
| Chimney Climb (Agility 14) | Gravelmaw interior shortcut past chamber 2 |
| Cairn Leap (Agility 14) | Terrace 3 gap, opens a fishing circuit |
| The Gravelmaw | 3 chambers plus a boss arena |

**Gravelmaw dungeon.** Entrance in the quarry face. Chamber 1 is a lit gallery with 4 Cairnwights. Chamber 2 is a dark collapse with 6 Scree Skitterlings and a 3-lever stone door puzzle (the levers are described in The Long Cairn's stage 5 dialogue). Chamber 3 is the cairn hall, 2 Thornbound Elders, and the quest terminus for The Long Cairn. The boss arena is a 24 m circular chamber behind a door that only opens after The Long Cairn completes.

**Ordrun the Quarrykeeper.** Tier 10, 200 HP, attack level 20, accuracy +50, armour +50, magicArmour +18, maxHit 11, attack speed 3.0 s.

- Phase 1 (100% to 55% HP): melee only, chases, leashes at 24 m.
- Transition at 55%: Ordrun plants and stone plates rise around the arena. 3 s of invulnerability.
- Phase 2 (55% to 0%): every 12 s Ordrun telegraphs a ground slam. A 5 m red decal appears for 1.6 s, then deals 22 damage to anyone standing in it. Its melee cadence drops to 2.4 s. Armour drops to +38, so the fight speeds up if the player survives the slams.
- Death drops 900 to 1,400 marks, one guaranteed Kaldite item from a 4-entry table, and the Quarrykeeper's Cairnstone quest item.

**Look.** Cold blue-grey slate, lichen green-yellow accents, a single warm firelight source per camp. Sparse props, but very large ones. Sightlines are vertical: the player can see three terraces at once from most positions, which makes route planning readable at a glance.

**Landmarks:** the Highcairn crane, the Great Cairn on terrace 4, the Gravelmaw mouth (a 12 m black wound in grey stone, visible from terrace 1 anywhere).

### Visual system

- **Palette.** Each region has a locked 8-swatch palette in `render/materials.ts`. Tier is communicated by material, never by scale alone: Grithe is a soft grey with a warm ochre vein, Corven is a green-shot bronze, Kaldite is a blue-black with a cyan fracture line. The same three material treatments apply to ore nodes, bars, and every weapon and armour piece, so a Kaldite sword and a Kaldite seam read as the same substance at 12 m.
- **Material system.** One `MeshStandardMaterial` template per (region, family) pair, parameterised by tier colour, roughness, and an emissive fracture mask. Quaternius meshes get their materials replaced at load, so a single mesh serves all tiers.
- **Silhouette rule.** Tier changes scale by at most 20% and always change proportion. A Kaldite sword is 12% longer than a Grithe sword but has a distinctly wider guard, so tier reads in shadow.
- **Camera.** Elevated third person. Distance 4 m to 22 m (default 12 m), pitch 18 to 68 degrees (default 38), full yaw, smooth follow with a 0.12 s lag, and a spring that pulls in when geometry occludes the player.
- **Assets.** Quaternius Medieval Village MegaKit for Coldbrace, Rootfall, and Highcairn. Stylized Nature MegaKit for all three regions' flora and rock. Fantasy Props MegaKit for interiors, shops, and quest props. Universal Base Characters plus Modular Character Outfits: Fantasy for the player and NPCs. Universal Animation Library 1 and 2 for locomotion, gather, attack, and death. `game/public/assets/manifest.json` holds asset id, local file, original pack, source URL, license, category, tags, dimensions, animation list, and material info for every file shipped.
- **Procedural composition.** Poisson-disc scatter for grass, rock, and small props, keyed off biome masks, with exclusion zones around roads, buildings, nodes, NPCs, and every navmesh link. Roads and rivers are authored splines. Everything gameplay-relevant is placed by hand in region data. The scatter never places anything the player can interact with.

---

## 5. UI and controls

### Controls

| Input | Action |
| --- | --- |
| Left click on ground | Click-to-move. Paths over the navmesh, shows a destination marker. |
| Left click on entity | Default interaction (mine / chop / fish / attack / talk / open / climb / pick up). |
| Right click on entity or ground | Context menu listing every interaction, including unavailable ones with their requirement text. |
| W / A / S / D | Direct movement, camera-relative, cancels any active path and activity. |
| Shift | Hold to walk (1.9 m/s). |
| Right-drag or middle-drag | Rotate camera. |
| Mouse wheel | Zoom, 4 m to 22 m. |
| Space | Interact with the hovered entity, or the selected one if nothing is hovered. |
| Esc | Close the top panel, otherwise cancel the active activity. |
| I / K / E / Q / J | Inventory, Skills, Equipment, Quests, Journal (Locations). |
| 1 to 4 | Quick slots. Slot 1 is the equipped spell, slots 2 to 4 are consumables. |
| F1 | Toggle overlays. |
| F3 | Debug HUD (FPS, draw calls, position, region, active activity). |

Every interaction reachable by mouse also has a keyboard route, because Playwright drives some tests through keys.

### Panels

| Panel | Contents |
| --- | --- |
| HUD | Health bar with numeric `cur/max`, marks count, active activity bar with a label and progress, floating XP drops, event toast strip (bottom-left, 4 lines, 6 s decay), compass strip, Recovery Cache countdown banner when one is live. |
| Inventory | 4 x 7 grid, drag to reorder, left click uses, right click opens the context menu, hover shows the tooltip. |
| Skills | 11 rows: icon, name, level, XP bar, XP to next. Clicking a row opens that skill's generated guide with every unlock at every tier. |
| Equipment | Nine slots laid out around a character silhouette, with the aggregate accuracy, power, armour, magicArmour, magicPower, and vitality totals shown below. |
| Bank | 8 x 10 visible grid with paging over 400 slots, quantity selector (1 / 5 / 10 / All / X), Deposit All button, substring name filter, inventory strip along the bottom for drag transfers. |
| Shop | Two columns, shop stock and player inventory, with buy and sell price on every row and a quantity selector. |
| Dialogue | Portrait, speaker name, body text, numbered option list. Options are keyboard-selectable with 1 to 9. |
| Quests | Left list grouped by region with status pips (not started / in progress / complete), right pane with the current stage text and the objective checklist. |
| Journal (Locations) | Every discovered location with its region, distance, and a Path button that draws the route overlay and starts navigation. This replaces the cut minimap. |
| Context menu | Appears at the cursor, lists interactions in priority order, greys unavailable entries with requirement text. |
| Tooltip | Item name, tier badge, equipment stats with a green/red delta against the currently equipped item, value, and requirements. |

### Overlays (four kinds only)

| Kind | Rendering | Set by |
| --- | --- | --- |
| `highlight` | Coloured outline on an entity's mesh, colour and thickness configurable | Player quest tracking, agent via `corealm_overlay` |
| `path` | A tube along a navmesh path, with an animated flow | Navigation, Journal Path button, agent |
| `marker` | A ground decal plus a screen-clamped off-screen arrow | Destination marker, quest targets, agent |
| `label` | A billboarded text sprite anchored to a world position or entity | Agent annotations |

Overlays live in their own scene layer, are excluded from picking, and are cleared by `corealm_overlay` with `op: "clear"` or F1.

---

## 6. Canonical game state

One store. `state/store.ts` owns it, everything else reads a frozen snapshot. Systems write through typed reducers so persistence and the debug API see one shape.

```ts
interface GameState {
  meta: {
    saveVersion: number;          // bump forces migrate.ts
    createdAtMs: number;
    lastSavedAtMs: number;
    playSeconds: number;
    seed: number;
  };
  player: {
    id: EntityId;                 // always "player"
    name: string;
    position: Vec3;
    facingRad: number;
    regionId: RegionId;
    health: number;
    maxHealth: number;            // derived, recomputed on skill or equipment change
    respawnPointId: string;       // "coldbrace" | "rootfall" | "highcairn"
    movement: {
      mode: "idle" | "path" | "direct";
      path: Vec3[] | null;
      pathIndex: number;
      destination: Vec3 | null;
      destinationEntityId: EntityId | null;
    };
  };
  skills: Record<SkillId, { xp: number; level: number }>;
  inventory: {
    slots: (InventorySlot | null)[];   // exactly 28
  };
  equipment: Record<EquipSlot, ItemStack | null>;   // exactly 9 keys
  bank: {
    slots: ItemStack[];                // <= 400, dense, no nulls
    filter: string;
  };
  currency: number;                    // marks, mirrored into inventory as a stack
  activity: ActivityState | null;      // exactly one at a time
  combat: {
    targetId: EntityId | null;
    inCombatUntilMs: number;
    nextAttackAtMs: number;
    activeSpellId: SpellId | null;
    engagedBy: EntityId[];
  };
  quests: Record<QuestId, {
    status: "unstarted" | "active" | "complete";
    stage: number;
    counters: Record<string, number>;
    flags: Record<string, boolean>;
  }>;
  dialogue: {
    npcId: EntityId;
    nodeId: string;
    text: string;
    speaker: string;
    options: { id: string; text: string; enabled: boolean; disabledReason?: string }[];
  } | null;
  world: {
    nodes: Record<EntityId, {
      remaining: number;
      state: "available" | "depleted";
      respawnAtMs: number | null;
    }>;
    enemies: Record<EntityId, {
      health: number;
      state: "idle" | "aggro" | "dead" | "returning";
      spawnPos: Vec3;
      respawnAtMs: number | null;
      bossPhase?: number;
    }>;
    obstaclesUsed: Record<EntityId, number>;   // traversal counts, for the journal
    lootPiles: Record<EntityId, {
      position: Vec3;
      items: ItemStack[];
      expiresAtMs: number;
      ownerOnly: boolean;
    }>;
    recoveryCache: {
      id: EntityId;
      position: Vec3;
      regionId: RegionId;
      items: ItemStack[];
      expiresAtMs: number;
    } | null;
  };
  discovery: {
    entities: Record<EntityId, number>;   // id -> first-seen wall clock ms
    locations: Record<string, number>;    // locationId -> first-visited ms
    regions: RegionId[];
  };
  settings: {
    cameraDistance: number;
    cameraPitchRad: number;
    overlaysVisible: boolean;
    uiScale: number;
  };
}
```

### The activity slice

Exactly one activity at a time, which is what makes agent parity easy to state and easy to test.

```ts
type ActivityState =
  | { kind: "gathering";  skill: SkillId; entityId: EntityId; nodeTier: number;
      startedAtMs: number; nextRollAtMs: number; yieldsThisSession: number }
  | { kind: "production"; skill: SkillId; recipeId: RecipeId; stationId: EntityId;
      remaining: number; completed: number; nextCompleteAtMs: number }
  | { kind: "traversing"; obstacleId: EntityId; endsAtMs: number }
  | { kind: "eating";     itemId: ItemId; endsAtMs: number };
```

Combat is not an activity. It runs in the `combat` slice so a player can eat while auto-attacking, which they need to survive Ordrun.

### Persistence

- Key `corealm.save.v1` in `localStorage`, JSON, roughly 40 KB for a fully progressed Phase 1 character.
- Autosave at most every 10 s when dirty, plus on `beforeunload`, plus immediately after death, level gain, quest stage change, and any bank write.
- `meta.saveVersion` gates `persistence/migrate.ts`. An unmigratable save shows a dialog offering export-to-clipboard and a fresh start. It never silently wipes.
- Content-derived values (`maxHealth`, skill `level`, prices, recipes) are recomputed on load rather than trusted, so a content rebalance applies to existing saves.

---

## 7. Modules and frozen interfaces

### 7.1 File layout under `game/src/`, one owner per file

Ownership letters map to the build rounds in section 9. `ROOT` means only the root agent edits the file.

```
game/src/
  main.ts                        ROOT
  contracts.ts                   ROOT  (frozen, section 7.2)
  app/
    boot.ts                      ROOT
    loop.ts                      ROOT
    config.ts                    ROOT
  core/
    rng.ts                       ROOT
    events.ts                    ROOT
    time.ts                      ROOT
    math.ts                      ROOT
  state/
    store.ts                     ROOT
    selectors.ts                 ROOT
  content/
    index.ts                     ROOT
    validate.ts                  ROOT
    xp.ts                        ROOT
    skills.ts                    ROOT
    items.ts                     C1
    equipment.ts                 C1
    resources.ts                 B1
    recipes.ts                   C1
    spells.ts                    D1
    enemies.ts                   D1
    npcs.ts                      E1
    quests.ts                    E1
    dialogue.ts                  E1
    regions.ts                   A1
    shops.ts                     C1
  world/
    entities.ts                  A1
    spatial.ts                   A1
    regionBuilder.ts             A1
    scatter.ts                   A2
    interactions.ts              A1
  systems/
    movement.ts                  A2
    navigation.ts                A2
    physics.ts                   A2
    inventory.ts                 B2
    bank.ts                      B2
    equipment.ts                 C2
    gathering.ts                 B1
    production.ts                C2
    economy.ts                   C2
    combat.ts                    D2
    enemyAI.ts                   D2
    health.ts                    D2
    death.ts                     D2
    agility.ts                   A3
    quests.ts                    E2
    dialogue.ts                  E2
  render/
    renderer.ts                  ROOT
    scene.ts                     A2
    camera.ts                    A2
    assets.ts                    ROOT
    materials.ts                 A2
    entityViews.ts               A2
    characterRig.ts              D3
    overlays.ts                  F2
    vfx.ts                       D3
  ui/
    hud.ts                       B4
    inventoryPanel.ts            B4
    skillsPanel.ts               B4
    equipmentPanel.ts            C3
    bankPanel.ts                 B4
    shopPanel.ts                 C3
    dialoguePanel.ts             E3
    questPanel.ts                E3
    journalPanel.ts              F3
    contextMenu.ts               A4
    tooltips.ts                  C3
    styles.css                   A4
  input/
    mouse.ts                     A4
    keyboard.ts                  A4
    picking.ts                   A4
  api/
    gameApi.ts                   ROOT
    observation.ts               F1
    docs.ts                      F3
  agent/
    webmcp.ts                    F1
    tools.ts                     F1
    events.ts                    F1
  persistence/
    storage.ts                   ROOT
    migrate.ts                   ROOT
  debug/
    gameDebug.ts                 ROOT
```

Rule: no worker edits `contracts.ts`, `store.ts`, `gameApi.ts`, or `gameDebug.ts`. A worker who needs a change there stops and reports, per AGENTS.md rule 5.

### 7.2 `game/src/contracts.ts`, the frozen exports

These signatures are the contract the root reviews and freezes before any parallel work.

```ts
// ---------- primitives ----------
export type Vec3 = readonly [number, number, number];
export type SkillId =
  | "melee" | "magic"
  | "mining" | "woodcutting" | "fishing"
  | "smithing" | "crafting" | "cooking" | "fletching"
  | "agility";

export type RegionId = "fallowmarch" | "vellenwood" | "karrowmoor" | "gravelmaw";

export type EquipSlot =
  | "head" | "body" | "legs" | "feet" | "hands"
  | "mainHand" | "offHand" | "accessory1" | "accessory2";

export type EntityId = string;   // "ore_t10_0042", "npc_coldbrace_smith", "player"
export type ItemId   = string;   // "kaldite_ore", "seared_cragfin"
export type RecipeId = string;
export type SpellId  = "emberlash" | "stonebrand" | "voltrend";
export type QuestId  = string;

export type Archetype =
  | "ore" | "tree" | "fishing_spot"
  | "enemy" | "boss" | "npc" | "station" | "bank" | "shop"
  | "obstacle" | "door" | "portal" | "loot" | "recovery_cache" | "landmark";

export type InteractionId =
  | "inspect" | "mine" | "chop" | "fish"
  | "attack" | "cast" | "talk" | "open" | "enter" | "climb" | "vault"
  | "loot" | "take" | "produce" | "bank" | "trade" | "equip" | "unequip";

// ---------- items and equipment ----------
export interface ItemStack { itemId: ItemId; quantity: number; }
export interface InventorySlot extends ItemStack { slotIndex: number; }

export interface EquipmentBonuses {
  accuracy: number;      // percent, additive
  power: number;         // melee maxHit input
  armour: number;        // percent, additive
  magicAccuracy: number;
  magicPower: number;
  magicArmour: number;
  vitality: number;      // flat max health
}

export interface ItemDef {
  id: ItemId;
  name: string;
  tier: number;                       // 1..99
  description: string;
  stackable: boolean;
  value: number;                      // shop buy price; sell is round(value * 0.6)
  category: "resource" | "bar" | "equipment" | "food" | "tool" | "quest" | "currency" | "component";
  equip?: {
    slot: EquipSlot;
    bonuses: EquipmentBonuses;
    attackSpeedMs?: number;           // main hand only
    requires: Partial<Record<SkillId, number>>;
  };
  food?: { healAmount: number };
  tool?: { skill: SkillId; gatherBonus: number };
}

// ---------- semantic entity, the shared world object ----------
export interface SemanticEntity {
  id: EntityId;
  archetype: Archetype;
  name: string;
  tier: number;
  regionId: RegionId;
  position: Vec3;
  state: string;                                   // archetype-specific, e.g. "available" | "depleted"
  requirements?: Partial<Record<SkillId, number>>;
  interactions: InteractionId[];
  resource?: { remaining: number; maxYields: number; respawnSeconds: number; itemId: ItemId };
  combat?: { health: number; maxHealth: number; level: number; aggroRadius: number };
  npc?: { dialogueRootId: string; questIds: QuestId[] };
  station?: { skill: SkillId; recipeIds: RecipeId[] };
  obstacle?: { reqLevel: number; exitPosition: Vec3; durationMs: number; savesMeters: number };
  meta?: Record<string, string | number | boolean>;
}

// ---------- observation, what the agent and UI can see ----------
export type ObservationScope = "visible" | "known";

export interface ObservedEntity {
  id: EntityId;
  archetype: Archetype;
  name: string;
  tier: number;
  regionId: RegionId;
  position: Vec3;
  distance: number;                 // metres from the player, path distance not straight line
  state: string;
  interactions: InteractionId[];
  requirementsMet: boolean;
  blockedBy?: string;               // "Requires Mining 10"
}

export interface ObserveFilter {
  scope?: ObservationScope;
  radius?: number;                  // default 40, max 140
  archetypes?: Archetype[];
  interaction?: InteractionId;
  requirementsMet?: boolean;
  regionId?: RegionId;
  limit?: number;                   // default 25, max 100
}

// ---------- errors ----------
export type GameErrorCode =
  | "NOT_FOUND" | "OUT_OF_RANGE" | "NOT_REACHABLE" | "REQUIREMENTS_NOT_MET"
  | "INVENTORY_FULL" | "BUSY" | "INVALID_ARGUMENT" | "DEAD" | "DEPLETED"
  | "NOT_ENOUGH_CURRENCY" | "NOT_ENOUGH_ITEMS" | "NO_DIALOGUE"
  | "TIMEOUT" | "UNAVAILABLE";

export interface GameError { code: GameErrorCode; message: string; entityId?: EntityId; }
export type Result<T> = { ok: true; value: T } | { ok: false; error: GameError };

// ---------- events ----------
export type GameEventType =
  | "navigation.started" | "navigation.completed" | "navigation.failed"
  | "activity.started" | "activity.stopped"
  | "resource.depleted" | "inventory.full"
  | "item.received" | "item.lost"
  | "combat.started" | "combat.ended"
  | "health.low" | "player.died"
  | "level.gained" | "production.completed"
  | "quest.updated" | "dialogue.opened" | "dialogue.closed"
  | "entity.discovered";

export interface GameEvent {
  seq: number;                      // monotonic, never reused
  type: GameEventType;
  atMs: number;                     // sim clock
  entityId?: EntityId;
  data: Record<string, unknown>;    // shape per type, documented in section 7.5
}

// ---------- the canonical API, the only way to change the world ----------
export interface GameApi {
  // state
  getPlayer(): PlayerView;
  getSkills(): Record<SkillId, { level: number; xp: number; xpToNext: number }>;
  getInventory(): { slots: (InventorySlot | null)[]; freeSlots: number };
  getEquipment(): { slots: Record<EquipSlot, ItemStack | null>; totals: EquipmentBonuses };
  getActivity(): ActivitySummary | null;
  getQuests(): QuestSummary[];
  getCurrency(): number;

  // observation
  observe(filter: ObserveFilter): ObservedEntity[];
  inspect(entityId: EntityId): Result<SemanticEntity>;
  searchDocs(query: string, limit?: number): DocHit[];

  // movement
  moveTo(target: { entityId: EntityId } | { position: Vec3 } | { locationId: string }): Result<{ pathLength: number; etaMs: number }>;
  stop(): Result<{ stopped: string[] }>;

  // interaction
  interact(entityId: EntityId, interaction: InteractionId): Result<{ started: string }>;
  useItem(itemId: ItemId, target?: { itemId: ItemId } | { entityId: EntityId }): Result<{ effect: string }>;
  equipItem(itemId: ItemId): Result<{ slot: EquipSlot; replaced: ItemId | null }>;
  unequipItem(slot: EquipSlot): Result<{ itemId: ItemId }>;
  produce(recipeId: RecipeId, quantity: number): Result<{ queued: number; durationMs: number }>;

  // combat
  attack(entityId: EntityId): Result<{ targetId: EntityId; attackSpeedMs: number }>;
  cast(spellId: SpellId, entityId: EntityId): Result<{ targetId: EntityId; castMs: number }>;

  // npc, bank, shop
  dialogue(op: "state" | "choose" | "end", optionId?: string): Result<DialogueView | null>;
  bank(op: "list" | "deposit" | "withdraw" | "depositAll", args?: { itemId?: ItemId; quantity?: number; filter?: string }): Result<BankView>;
  shop(op: "list" | "buy" | "sell", args?: { shopId?: EntityId; itemId?: ItemId; quantity?: number }): Result<ShopView>;

  // overlays
  overlay(op: "set" | "clear", spec?: OverlaySpec): Result<{ activeCount: number }>;

  // events
  events(sinceSeq: number, filter?: GameEventType[], timeoutMs?: number): Promise<{ events: GameEvent[]; nextSeq: number }>;
}

export interface PlayerView {
  position: Vec3; regionId: RegionId; health: number; maxHealth: number;
  inCombat: boolean; dead: boolean; moving: boolean; activityKind: string | null;
  combatLevelEstimate: number;
}

export interface ActivitySummary {
  kind: string; skill?: SkillId; entityId?: EntityId; recipeId?: RecipeId;
  progress: number;            // 0..1 for the current unit
  completed: number; remaining: number;
}

export interface QuestSummary {
  id: QuestId; name: string; regionId: RegionId;
  status: "unstarted" | "active" | "complete";
  stage: number; stageCount: number;
  currentObjective: string | null;
  requirements: Partial<Record<SkillId, number>>;
}

export interface DialogueView {
  npcId: EntityId; speaker: string; text: string;
  options: { id: string; text: string; enabled: boolean; disabledReason?: string }[];
}

export interface BankView { slots: ItemStack[]; usedSlots: number; capacity: number; }
export interface ShopView { shopId: EntityId; stock: { itemId: ItemId; name: string; buyPrice: number; sellPrice: number; quantity: number }[]; currency: number; }
export interface DocHit { docId: string; title: string; section: string; snippet: string; score: number; }

export interface OverlaySpec {
  id: string;
  kind: "highlight" | "path" | "marker" | "label";
  entityId?: EntityId;
  position?: Vec3;
  path?: Vec3[];
  text?: string;
  colour?: string;             // "#rrggbb"
  ttlMs?: number;              // default 0, meaning until cleared
}
```

`gameApi.ts` is the single implementation of `GameApi`. `ui/*`, `agent/tools.ts`, and `debug/gameDebug.ts` all go through it. There is no second path into the world.

### 7.3 Content schemas the workers author against

`content/validate.ts` runs a hand-written validator (no external schema dependency) over every content file at boot and throws with the offending id. Required shapes:

```ts
export interface ResourceNodeDef {
  id: string; archetype: "ore" | "tree" | "fishing_spot"; tier: number;
  name: string; skill: SkillId; reqLevel: number; itemId: ItemId;
  assetId: string; depletedAssetId: string;
}

export interface RecipeDef {
  id: RecipeId; name: string; skill: SkillId; reqLevel: number; tier: number;
  inputs: ItemStack[]; output: ItemStack; xp: number; durationMs: number;
  stationKind: "furnace" | "anvil" | "range" | "crafting_table" | "fletching_bench";
}

export interface SpellDef {
  id: SpellId; name: string; tier: number; reqLevel: number;
  baseMax: number; divisor: number; baseXp: number; castMs: number;
  costItemId: ItemId; costQuantity: number; vfxId: string;
}

export interface EnemyDef {
  id: string; family: string; name: string; tier: number;
  maxHealth: number; attackLevel: number; defenceLevel: number;
  accuracy: number; armour: number; magicArmour: number;
  maxHit: number; attackSpeedMs: number;
  behaviour: "passive" | "aggressive" | "territorial";
  aggroRadius: number; leashRadius: number;
  lootTable: { itemId: ItemId; min: number; max: number; chance: number }[];
  assetId: string; animationSet: string;
  boss?: { phases: { atHealthFraction: number; armour: number; attackSpeedMs: number; telegraphId?: string }[] };
}

export interface QuestDef {
  id: QuestId; name: string; regionId: RegionId;
  kind: "local" | "skill" | "puzzle" | "dungeon" | "chain";
  requirements: Partial<Record<SkillId, number>>;
  prerequisiteQuestIds: QuestId[];
  stages: QuestStageDef[];
  rewards: { xp: Partial<Record<SkillId, number>>; items: ItemStack[]; currency: number; unlocks: string[] };
}

export interface QuestStageDef {
  index: number;
  objective: string;                  // shown in the quest panel and returned by getQuests()
  completion:
    | { kind: "talk"; npcId: EntityId; dialogueNodeId: string }
    | { kind: "have"; itemId: ItemId; quantity: number }
    | { kind: "kill"; enemyFamily: string; count: number }
    | { kind: "gather"; itemId: ItemId; count: number }
    | { kind: "produce"; recipeId: RecipeId; count: number }
    | { kind: "reach"; locationId: string }
    | { kind: "traverse"; obstacleId: EntityId }
    | { kind: "flag"; flag: string };
  hint: string;                       // surfaced through docs search and the quest panel
}

export interface RegionDef {
  id: RegionId; name: string; tier: number; seed: number;
  bounds: { min: Vec3; max: Vec3 };
  spawnPoint: Vec3; respawnPointId: string;
  terrainAssetId: string; navmeshFile: string;
  palette: string[];                  // exactly 8 hex swatches
  placements: PlacementDef[];         // authored, one per gameplay entity
  scatter: ScatterLayerDef[];         // seeded, no gameplay entities
  links: { toRegionId: RegionId; position: Vec3; exitPosition: Vec3 }[];
}
```

### 7.4 The WebMCP tool set, 16 tools

Design rule: a tool is one player verb, not one code path. Every tool maps to a `GameApi` call, every tool returns a plain JSON object, and every failure returns `{ error: { code, message } }` with a code from `GameErrorCode`.

Registration goes through the browser's WebMCP registration API in `agent/webmcp.ts`, behind a thin adapter so a spec change touches one file. The same tool table is callable in-page through `__gameDebug.callTool(name, args)`, which is how Playwright proves human and agent parity.
| # | Tool | Purpose |
| --- | --- | --- |
| 1 | `corealm_get_state` | Everything about the player, filtered by section |
| 2 | `corealm_observe` | List entities, visible or known |
| 3 | `corealm_inspect` | Full detail on one entity |
| 4 | `corealm_search_docs` | Query the generated documentation |
| 5 | `corealm_move` | Navigate to an entity, a location, or a point |
| 6 | `corealm_interact` | Start any world interaction |
| 7 | `corealm_stop` | Cancel movement, activity, and combat |
| 8 | `corealm_attack` | Melee or spell attack |
| 9 | `corealm_use_item` | Eat, use, or use-on |
| 10 | `corealm_equip` | Equip or unequip |
| 11 | `corealm_produce` | Start a production batch |
| 12 | `corealm_dialogue` | Read, choose, or end dialogue |
| 13 | `corealm_bank` | List, deposit, withdraw, deposit all |
| 14 | `corealm_shop` | List, buy, sell |
| 15 | `corealm_overlay` | Set or clear assistance overlays |
| 16 | `corealm_events` | Drain or wait on the event queue |

**1. `corealm_get_state`**
Args: `{ sections?: ("player"|"skills"|"inventory"|"equipment"|"activity"|"quests"|"currency")[] }`. Default returns `player`, `activity`, and `currency` only, which keeps the common poll under 200 tokens.
Returns: `{ player?: PlayerView, skills?: {...}, inventory?: {...}, equipment?: {...}, activity?: ActivitySummary|null, quests?: QuestSummary[], currency?: number }`.
Errors: `INVALID_ARGUMENT` on an unknown section.

**2. `corealm_observe`**
Args: `{ scope?: "visible"|"known", radius?: number, archetypes?: Archetype[], interaction?: InteractionId, requirementsMet?: boolean, regionId?: RegionId, limit?: number }`. Defaults: `scope: "visible"`, `radius: 40`, `limit: 25`. Radius caps at 140 which is the view distance, and `scope: "known"` ignores radius and returns discovered entities and locations across all visited regions.
Returns: `{ entities: ObservedEntity[], truncated: boolean, totalMatched: number }`.
Errors: `INVALID_ARGUMENT`.

**3. `corealm_inspect`**
Args: `{ entityId: string }`.
Returns: the full `SemanticEntity` plus `{ distance: number, requirementsMet: boolean, blockedBy?: string, reachable: boolean }`.
Errors: `NOT_FOUND` if the id does not exist or has never been discovered.

**4. `corealm_search_docs`**
Args: `{ query: string, limit?: number }` (default 5, max 20).
Returns: `{ hits: DocHit[] }`.
Errors: `INVALID_ARGUMENT` on an empty query. Never returns undiscovered quest content.

**5. `corealm_move`**
Args: `{ to: { entityId: string } | { locationId: string } | { position: [number,number,number] }, stopWithin?: number, wait?: boolean, timeoutMs?: number }`. `stopWithin` defaults to the target's interaction range. `wait` defaults to `false`, so the tool returns immediately and the agent listens for `navigation.completed`. `wait: true` blocks until arrival or `timeoutMs` (default 60000, max 180000).
Returns: `{ started: true, pathLength: number, etaMs: number, arrived?: boolean, position?: Vec3 }`.
Errors: `NOT_FOUND`, `NOT_REACHABLE` (no navmesh path), `DEAD`, `TIMEOUT`, `INVALID_ARGUMENT`.
Movement always runs at 4.2 m/s on the navmesh. There is no fast path.

**6. `corealm_interact`**
Args: `{ entityId: string, interaction: InteractionId }`.
Returns: `{ started: "gathering"|"production"|"traversing"|"dialogue"|"bank"|"shop"|"loot"|"door", activity?: ActivitySummary }`.
Errors: `NOT_FOUND`, `OUT_OF_RANGE` (with the required distance in the message), `REQUIREMENTS_NOT_MET`, `DEPLETED`, `INVENTORY_FULL`, `BUSY`, `DEAD`, `UNAVAILABLE`.
One call starts exactly the continuing activity one human click starts.

**7. `corealm_stop`**
Args: `{ what?: ("movement"|"activity"|"combat")[] }`, defaults to all three.
Returns: `{ stopped: string[] }`. Never errors except `DEAD`.

**8. `corealm_attack`**
Args: `{ entityId: string, spellId?: SpellId }`. Omitting `spellId` means melee.
Returns: `{ targetId: string, attackSpeedMs: number, targetHealth: number, targetMaxHealth: number }`.
Errors: `NOT_FOUND`, `OUT_OF_RANGE`, `REQUIREMENTS_NOT_MET` (spell level), `NOT_ENOUGH_ITEMS` (no essence shards), `DEAD`, `UNAVAILABLE` (target already dead or non-hostile).

**9. `corealm_use_item`**
Args: `{ itemId: string, on?: { itemId: string } }`.
Returns: `{ effect: string, healed?: number, consumed?: ItemStack }`.
Errors: `NOT_ENOUGH_ITEMS`, `NOT_FOUND`, `OUT_OF_RANGE`, `BUSY`, `UNAVAILABLE`, `DEAD`.

**10. `corealm_equip`**
Args: `{ op: "equip"|"unequip", itemId?: string, slot?: EquipSlot }`. `equip` needs `itemId`, `unequip` needs `slot`.
Returns: `{ slot: EquipSlot, itemId: string|null, replaced: string|null, totals: EquipmentBonuses, maxHealth: number }`.
Errors: `NOT_FOUND`, `NOT_ENOUGH_ITEMS`, `REQUIREMENTS_NOT_MET`, `INVENTORY_FULL` (unequip with a full inventory), `INVALID_ARGUMENT`.

**11. `corealm_produce`**
Args: `{ recipeId: string, quantity: number }` (quantity 1 to 28).
Returns: `{ queued: number, durationMs: number, perUnitXp: number, missing?: ItemStack[] }`.
Errors: `NOT_FOUND`, `OUT_OF_RANGE` (not at the right station), `REQUIREMENTS_NOT_MET`, `NOT_ENOUGH_ITEMS`, `BUSY`, `INVENTORY_FULL`.

**12. `corealm_dialogue`**
Args: `{ op: "state"|"choose"|"end", optionId?: string }`.
Returns: `DialogueView | null`, plus `{ questUpdated?: QuestId }` when a choice advances a quest.
Errors: `NO_DIALOGUE`, `INVALID_ARGUMENT` (unknown or disabled option), `UNAVAILABLE`.

**13. `corealm_bank`**
Args: `{ op: "list"|"deposit"|"withdraw"|"depositAll", itemId?: string, quantity?: number, filter?: string }`. `quantity: -1` means all of that item.
Returns: `{ slots: ItemStack[], usedSlots: number, capacity: 400, moved?: ItemStack }`.
Errors: `OUT_OF_RANGE` (not at a bank), `NOT_ENOUGH_ITEMS`, `INVENTORY_FULL`, `INVALID_ARGUMENT`.

**14. `corealm_shop`**
Args: `{ op: "list"|"buy"|"sell", itemId?: string, quantity?: number }`. The shop is whichever one the player currently has open.
Returns: `ShopView` plus `{ traded?: ItemStack, marksDelta?: number }`.
Errors: `OUT_OF_RANGE`, `NOT_ENOUGH_CURRENCY`, `NOT_ENOUGH_ITEMS`, `INVENTORY_FULL`, `UNAVAILABLE` (shop does not buy that item).

**15. `corealm_overlay`**
Args: `{ op: "set"|"clear", overlays?: OverlaySpec[], ids?: string[] }`. `clear` with no `ids` clears everything the agent set. Cap of 32 simultaneous agent overlays.
Returns: `{ activeCount: number }`.
Errors: `INVALID_ARGUMENT`, `NOT_FOUND` (overlay anchored to an unknown entity).
Overlays are cosmetic. They never change game state, which keeps agent parity honest.

**16. `corealm_events`**
Args: `{ sinceSeq: number, types?: GameEventType[], timeoutMs?: number, maxEvents?: number }`. `timeoutMs: 0` (default) drains immediately. Any positive value up to 180000 blocks until a matching event arrives or the timeout fires.
Returns: `{ events: GameEvent[], nextSeq: number, dropped: number }`. `dropped` is non-zero when the agent fell more than 256 events behind, which tells it to re-sync with `corealm_get_state`.
Errors: `INVALID_ARGUMENT`. A timeout returns `{ events: [], nextSeq }` rather than an error, because an empty wait is a normal result.

**Token-efficiency shape.** The intended agent loop is: `corealm_get_state` once at start, `corealm_observe` once per location change, `corealm_interact` to start an activity, then `corealm_events` with a long timeout until something happens. A well-built agent mining from 1 to 10 should need under 60 tool calls. A polling agent needs several hundred, and that gap is the metagame.

### 7.5 Events and delivery

**Delivery mechanism.** `agent/events.ts` owns a 256-entry ring buffer of `GameEvent`, with a monotonic `seq` that never resets inside a session. Systems append through `core/events.ts` during sim tick 14 (section 3), so all events for a tick land together and in a stable order. Three consumers read the same buffer:

- `corealm_events` over WebMCP, cursor-based with optional long-poll. Waiters register a promise plus a type filter and resolve on the next matching append or on timeout. This is the primary mechanism, and it works regardless of what push support the WebMCP implementation has.
- The HUD toast strip, which subscribes in-process.
- `__gameDebug.getEvents(sinceSeq)`, which does a non-blocking drain for Playwright.

If the shipping WebMCP implementation supports server-initiated notifications, `agent/webmcp.ts` also pushes each event as a notification. That is an enhancement layered on top, never the only path, because the spec surface is the biggest unknown in this build (see section 10).

**Event catalogue.** `data` shapes are exact.

| Type | `data` |
| --- | --- |
| `navigation.started` | `{ to: Vec3, entityId?: string, pathLength: number, etaMs: number }` |
| `navigation.completed` | `{ at: Vec3, entityId?: string, tookMs: number }` |
| `navigation.failed` | `{ reason: "unreachable"\|"blocked"\|"cancelled"\|"dead", at: Vec3 }` |
| `activity.started` | `{ kind: string, skill?: SkillId, entityId?: string, recipeId?: string }` |
| `activity.stopped` | `{ kind: string, reason: "completed"\|"depleted"\|"inventory_full"\|"moved"\|"combat"\|"cancelled"\|"missing_items"\|"died", completed: number }` |
| `resource.depleted` | `{ entityId: string, itemId: string, respawnInSeconds: number, yieldsTaken: number }` |
| `inventory.full` | `{ blockedItemId: string }` |
| `item.received` | `{ itemId: string, quantity: number, source: "gather"\|"loot"\|"produce"\|"quest"\|"shop"\|"bank" }` |
| `item.lost` | `{ itemId: string, quantity: number, reason: "consumed"\|"sold"\|"banked"\|"died"\|"burnt" }` |
| `combat.started` | `{ targetId: string, targetName: string, targetLevel: number, initiator: "player"\|"enemy" }` |
| `combat.ended` | `{ targetId: string, outcome: "killed"\|"escaped"\|"died"\|"leashed", xpGained: number }` |
| `health.low` | `{ health: number, maxHealth: number, fraction: number }` fires once per crossing below 0.30 |
| `player.died` | `{ at: Vec3, regionId: RegionId, killerId?: string, cacheId: string, cacheExpiresAtMs: number, respawnAt: Vec3 }` |
| `level.gained` | `{ skill: SkillId, level: number, unlocked: string[] }` |
| `production.completed` | `{ recipeId: string, itemId: string, quantity: number, xp: number, burnt: boolean, remaining: number }` |
| `quest.updated` | `{ questId: string, status: string, stage: number, stageCount: number, objective: string\|null }` |
| `dialogue.opened` | `{ npcId: string, speaker: string, optionCount: number }` |
| `dialogue.closed` | `{ npcId: string }` |
| `entity.discovered` | `{ entityId: string, archetype: Archetype, name: string, regionId: RegionId }` |

Events report facts. They never contain instructions, and they never leak undiscovered content. `entity.discovered` fires only after the entity has actually entered the player's 40 m observation radius with line of sight.

### 7.6 `window.__gameDebug`

Never called by game code. Installed by `debug/gameDebug.ts` at boot, and it wraps `GameApi` rather than reaching into the store.

**Harness-required methods (9).** These are the generic contract `tools/` depends on. The root must confirm the exact names against the existing harness before freezing, since this PRD agent did not read `tools/` (see section 10, assumption A1).

| # | Method | Signature | Purpose |
| --- | --- | --- | --- |
| 1 | `ready` | `() => boolean` | True once boot step 10 completes. Playwright polls this before anything else. |
| 2 | `getState` | `() => GameState` | Deep-cloned, JSON-safe snapshot of the whole canonical state. |
| 3 | `getVersion` | `() => { build: string; contracts: string; content: string }` | Build hash, contracts hash, content hash. Detects a stale bundle. |
| 4 | `setPaused` | `(paused: boolean) => void` | Halts the sim loop. Rendering continues so screenshots stay valid. |
| 5 | `step` | `(ms: number) => void` | Advances the sim by exactly `ms` while paused, in 100 ms sim ticks. |
| 6 | `getMetrics` | `() => { fps, frameMs, drawCalls, triangles, entityCount, heapMB }` | The performance assertion source. |
| 7 | `getErrors` | `() => { atMs: number; source: string; message: string; stack?: string }[]` | Every console error, unhandled rejection, and content validation warning since boot. |
| 8 | `waitForIdle` | `(timeoutMs?: number) => Promise<boolean>` | Resolves when no navigation, activity, combat, or asset load is pending. The standard "settle" call before a state comparison. |
| 9 | `reset` | `(opts?: { seed?: number; keepSave?: boolean }) => Promise<void>` | Wipes the save (unless `keepSave`), reseeds, rebuilds the world, resolves when `ready()` is true again. |

**Game-specific deterministic-test helpers.** Everything Phase 1 needs to make a scenario reproducible in under 30 seconds of wall clock.

| Method | Signature | Purpose |
| --- | --- | --- |
| `setTimeScale` | `(scale: number) => void` | 0.1 to 100. Multiplies the sim clock only. Render stays real time. |
| `advanceGameTime` | `(seconds: number) => void` | Jumps node respawn timers, loot expiry, and the recovery cache clock forward without simulating the frames between. |
| `teleport` | `(to: Vec3 \| { entityId: string } \| { locationId: string }) => void` | Snaps the player to the navmesh at the target. Test setup only, never exposed to WebMCP. |
| `grantXp` | `(skill: SkillId, amount: number) => void` | Adds XP through the real level-up path so `level.gained` still fires. |
| `setSkillLevel` | `(skill: SkillId, level: number) => void` | Sets XP to `totalXpAt(level)` exactly. Used to set up tier 10 scenarios without an hour of grinding. |
| `giveItem` | `(itemId: ItemId, quantity: number, to?: "inventory" \| "bank") => Result<void>` | Defaults to inventory, respects the 28-slot limit and returns `INVENTORY_FULL`. |
| `clearInventory` | `() => void` | Empties all 28 slots. |
| `setCurrency` | `(marks: number) => void` | Sets the mark balance. |
| `setHealth` | `(health: number) => void` | Clamped to `[0, maxHealth]`. Setting 0 runs the real death path. |
| `setSeed` | `(seed: number) => void` | Reseeds every RNG stream. Combined with `setPaused` and `step`, makes combat rolls reproducible. |
| `loadScenario` | `(name: string) => Promise<void>` | Applies a named fixture from `debug/scenarios.ts`. Phase 1 ships: `fresh`, `tier1_ready`, `tier5_ready`, `tier10_ready`, `boss_ready`, `bank_full`, `quest_longcairn_stage4`, `dead_with_cache`. |
| `forceRespawn` | `(entityId: EntityId) => void` | Immediately respawns a node or enemy. |
| `depleteNode` | `(entityId: EntityId) => void` | Sets `remaining` to 0 and runs the real depletion path. |
| `setQuestStage` | `(questId: QuestId, stage: number) => void` | Jumps a quest to a stage, applying prior-stage flags. |
| `getEntity` | `(entityId: EntityId) => SemanticEntity \| null` | Full entity, ignoring discovery gating. Test-only visibility. |
| `listEntities` | `(filter?: { archetype?: Archetype; regionId?: RegionId; tier?: number }) => SemanticEntity[]` | Ungated entity listing for locating test targets. |
| `getEvents` | `(sinceSeq: number) => { events: GameEvent[]; nextSeq: number }` | Non-blocking drain of the same ring buffer WebMCP reads. |
| `callTool` | `(name: string, args: unknown) => Promise<unknown>` | Invokes a WebMCP tool in-page. This is how the parity tests prove one agent call equals one human click. |
| `getNavPath` | `(from: Vec3, to: Vec3) => Vec3[] \| null` | Raw navmesh query, for asserting reachability and path length. |
| `focusCamera` | `(shotId: string) => Promise<void>` | Moves the camera to a named repeatable screenshot pose from `debug/shots.ts`, resolves when the frame is stable. |
| `listShots` | `() => string[]` | The 18 screenshot ids in section 8.7. |
| `saveNow` | `() => Promise<void>` | Forces a persistence write. |
| `getSaveBlob` | `() => string` | The raw JSON that would be written. |
| `loadSaveBlob` | `(json: string) => Promise<void>` | Loads a save, runs migrations, rebuilds the world. |

---

## 8. Acceptance criteria as browser-observable checks

Every criterion below is a Playwright script that touches `window.__gameDebug`, performs an action the way a human or agent would, and compares state. No criterion is satisfied by reading source.

Shared preamble for every test:

```js
await page.waitForFunction(() => window.__gameDebug?.ready() === true, { timeout: 20000 });
await page.evaluate(() => window.__gameDebug.reset({ seed: 1337 }));
await page.evaluate(() => window.__gameDebug.waitForIdle());
```

Every test ends by asserting `__gameDebug.getErrors()` has length 0.

### 8.1 Boot and world

| # | Check |
| --- | --- |
| A1 | `ready()` returns true within 20 s. `getErrors()` is empty. |
| A2 | `getState().player.regionId === "fallowmarch"` and `getState().player.position` is within 3 m of Fallowmarch's `spawnPoint`. |
| A3 | `listEntities({ regionId: "fallowmarch" })` returns at least 40 entities, including at least 6 with `archetype === "ore"` and `tier === 1`. |
| A4 | `getMetrics().fps >= 55` averaged over 5 s at the `town_center` shot, and `getMetrics().drawCalls < 400`. |
| A5 | After `focusCamera("vellenwood_canopy")`, `getMetrics().fps >= 55` and `drawCalls < 400`. |

### 8.2 Movement, camera, navigation

| # | Check |
| --- | --- |
| B1 | Record `p0 = getState().player.position`. Hold `KeyW` for 1000 ms. `p1` differs from `p0` by 3.6 m to 4.8 m, and `p1[1]` follows terrain height within 0.5 m. |
| B2 | Click a ground point 60 m away. Within 200 ms `getState().player.movement.mode === "path"` and `path.length > 1`. Await `navigation.completed`. Final position is within 1.5 m of the click target. |
| B3 | `getNavPath(coldbraceBank, upperKarrowSeam)` returns a non-null path of length 380 m to 460 m, proving the three regions are connected on one navmesh. |
| B4 | Click a point inside a building's collider. The event is `navigation.failed` with `reason: "unreachable"`, or the player stops at the nearest valid point without penetrating the collider. Never both. |
| B5 | Scroll wheel changes `getState().settings.cameraDistance` within `[4, 22]`, and right-drag changes camera yaw. `focusCamera` restores an exact pose, byte-identical screenshots across two runs at the same seed. |
| B6 | While the player walks a 40 m path, `getMetrics().fps >= 55` throughout. |

### 8.3 Gathering, inventory, banking

| # | Check |
| --- | --- |
| C1 | `setSkillLevel("mining", 1)`, `clearInventory()`, teleport near a tier 1 ore node, then `callTool("corealm_interact", { entityId, interaction: "mine" })`. `getState().activity.kind === "gathering"` within 200 ms and an `activity.started` event exists. |
| C2 | From C1, `setTimeScale(20)` and wait for 3 `item.received` events. `getState().skills.mining.xp === 30` exactly (3 yields x 10 XP), and inventory holds 3 `grithe_ore` in 3 separate slots (ore does not stack). |
| C3 | Continue until `resource.depleted` fires. `getState().world.nodes[id].state === "depleted"`, `remaining === 0`, `respawnAtMs` is set, and the yields taken are between 9 and 15. |
| C4 | `advanceGameTime(22)`. The node's state is `"available"` and `remaining` is between 9 and 15 again. |
| C5 | `giveItem` to fill 28 slots, then start gathering. `activity.stopped` fires with `reason: "inventory_full"` and an `inventory.full` event fires. `activity` is null. |
| C6 | With 20 ore held, walk to the Coldbrace bank and `callTool("corealm_bank", { op: "depositAll" })`. Inventory `freeSlots === 28`, `getState().bank.slots` contains one entry with `quantity: 20`. |
| C7 | `callTool("corealm_bank", { op: "withdraw", itemId: "grithe_ore", quantity: 5 })` from 15 m away returns `error.code === "OUT_OF_RANGE"` and the bank is unchanged. |
| C8 | Mining 1 to 10 by gathering alone, with `setTimeScale(50)`, completes and produces exactly one `level.gained` event per level from 2 through 10, in order. Final `getState().skills.mining.xp >= 1725`. |

### 8.4 Production, equipment, economy

| # | Check |
| --- | --- |
| D1 | `loadScenario("tier1_ready")`, walk to the Coldbrace furnace, `corealm_produce({ recipeId: "smelt_grithe_bar", quantity: 5 })`. Five `production.completed` events fire. Smithing XP increases by exactly 40 (5 x 8). |
| D2 | At the anvil, produce `grithe_sword`. Smithing XP increases by exactly 35, and a `grithe_sword` appears in inventory. |
| D3 | `corealm_equip({ op: "equip", itemId: "grithe_sword" })`. `getState().equipment.mainHand.itemId === "grithe_sword"`, `equipment.totals.power === 6`, and `player.maxHealth` matches the section 2.3 formula. |
| D4 | Attempt to equip a Kaldite sword at Melee 1. Error is `REQUIREMENTS_NOT_MET` and the message names the skill and level. Equipment is unchanged. |
| D5 | At the range with raw fish and Cooking 1, produce 10 cooked fish. Burnt count is between 2 and 7 (the 0.45 burn chance at the requirement level), and `burnt: true` events carry 0 XP. |
| D6 | `setSkillLevel("cooking", 16)` and repeat D5. Burnt count is 0. |
| D7 | Sell 10 Grithe ore at the general shop. Currency increases by exactly 70 (10 x 7), inventory loses exactly 10 ore. |
| D8 | Buy with insufficient marks. Error is `NOT_ENOUGH_CURRENCY`, currency and inventory unchanged. |
| D9 | Craft 5 essence shards, cast Voltrend once. Shard count drops by exactly 1. Casting with 0 shards returns `NOT_ENOUGH_ITEMS`. |

### 8.5 Combat, health, death

| # | Check |
| --- | --- |
| E1 | `loadScenario("tier1_ready")`, `setSeed(99)`, attack a Rill Skitterling. `combat.started` fires, `getState().combat.targetId` is set, and the enemy's health drops on the next combat tick. |
| E2 | With `setPaused(true)` then `step(2400)` repeated, damage values are identical across two runs at the same seed. |
| E3 | Kill the Skitterling. `combat.ended` fires with `outcome: "killed"`, Melee XP increases by exactly `4 * damageDealt + 12`, and a loot pile entity exists at the corpse position. |
| E4 | `corealm_interact` with `loot` on the pile leaves inventory and the pile unchanged while opening its exact stack grid beside the container. Clicking a stack, or using the matching semantic take command, transfers only that stack. The pile disappears after its final stack is taken. |
| E5 | Magic parity: equip a Kaldite staff, `corealm_attack({ entityId: cairnwight, spellId: "voltrend" })`. Magic XP increases by `4 * damage + 22` per cast. |
| E6 | `setHealth(6)` while in combat. `health.low` fires exactly once. Eating a cooked fish raises health by exactly `healAmount(tier)` and blocks attacks for 1800 ms. |
| E7 | `setHealth(0)`. `player.died` fires. `getState().world.recoveryCache` is non-null with every pre-death inventory item, `getState().inventory` is empty, `getState().equipment` is unchanged, and skill XP is unchanged. Player position equals the Coldbrace respawn point and health equals `maxHealth`. |
| E8 | Walk to the cache and open it. Opening changes nothing. Taking every displayed stack returns every item and makes the cache null. |
| E9 | `advanceGameTime(901)` on a live cache. The cache becomes null and the items are gone. |
| E10 | `loadScenario("boss_ready")`, fight Ordrun. At health fraction 0.55, `getState().world.enemies.ordrun.bossPhase` changes from 1 to 2. A telegraph overlay exists for 1600 ms before the slam, and standing in it costs exactly 22 health. |

### 8.6 Quests, dialogue, agility, persistence, agent

| # | Check |
| --- | --- |
| F1 | `corealm_interact` with `talk` on the Coldbrace smith. `dialogue.opened` fires, `getState().dialogue` is non-null with at least 2 options. |
| F2 | `corealm_dialogue({ op: "choose", optionId })` accepting Cold Iron sets `getState().quests.cold_iron.status === "active"` and fires `quest.updated`. |
| F3 | Completing every stage of Cold Iron moves `status` to `"complete"`, adds the exact reward XP per skill, the exact item stacks, and the exact mark amount from the quest definition. |
| F4 | Selecting a disabled dialogue option returns `INVALID_ARGUMENT` and does not change `getState().dialogue.nodeId`. |
| F5 | `setSkillLevel("agility", 10)`, traverse Sunder Ledge. Agility XP increases by exactly 63, and the player's post-traversal position is within 1 m of the obstacle's `exitPosition`. `getNavPath` from the bank via the shortcut is under 60 m against 185 m to 200 m without it. |
| F6 | `setSkillLevel("agility", 10)` and fail-force by seed: on failure, health drops by 2 to 6, Agility XP is unchanged, and the player is at `failPoint`. |
| F7 | Full persistence: after a session that levels 4 skills, banks 30 items, completes 2 quests, and discovers 2 regions, `page.reload()` reproduces `skills`, `bank`, `quests`, `discovery`, `equipment`, and `currency` exactly. |
| F8 | `getSaveBlob()` parses as JSON under 100 KB. `reset()` then `loadSaveBlob(blob)` restores an identical `getState()` apart from `meta.lastSavedAtMs`. |
| F9 | Parity: `callTool("corealm_interact", { entityId: ore, interaction: "mine" })` and a real mouse click on the same node produce the same `activity.started` event payload and the same `ActivityState` shape. |
| F10 | Information parity: `corealm_inspect` on an entity the player has never seen returns `NOT_FOUND`. After the player walks within 40 m with line of sight, `entity.discovered` fires and `corealm_inspect` succeeds. |
| F11 | `corealm_search_docs({ query: "kaldite" })` returns hits covering the ore, the bar, and at least one recipe, and returns nothing from an unstarted quest's hidden stages. |
| F12 | `corealm_events` with `timeoutMs: 5000` while idle returns `{ events: [], nextSeq }` after roughly 5 s without throwing. The same call while gathering returns within one gather tick. |
| F13 | Event-efficiency budget: a scripted agent that mines 1 to 10 using `interact` plus `corealm_events` makes fewer than 60 tool calls total, counted by a `callTool` wrapper. |
| F14 | Overlays: `corealm_overlay({ op: "set", overlays: [{ id: "x", kind: "highlight", entityId }] })` returns `activeCount: 1`, the screenshot shows the outline, and `getState()` is unchanged apart from nothing (overlays live outside canonical state). |
| F15 | Agent gate proof: a scripted agent using only WebMCP tools raises Mining from 1 to 10 and ends with at least 40 ore in the bank, with no `__gameDebug` call other than `setTimeScale`. |
| F16 | Agent quest proof: a scripted agent using only WebMCP tools takes The Long Cairn from unstarted to `"complete"` across all 7 stages. |

### 8.7 Screenshot set, 18 repeatable shots

Every id is a `focusCamera` pose in `debug/shots.ts`, captured after `waitForIdle()` at a fixed seed, so two runs produce comparable images.

`spawn`, `town_entrance`, `town_center`, `bank_interior`, `palewood_copse`, `bracken_pit`, `marchfield`, `redsill_shallows`, `vellenwood_canopy`, `rootfall_hamlet`, `karrowmoor_terraces`, `highcairn_outpost`, `gravelmaw_entrance`, `gravelmaw_chamber2`, `combat_normal`, `boss_ordrun_phase2`, `ui_inventory_skills`, `overlay_showcase`.

Each shot must show: correct tier materials, readable silhouettes at the default camera pitch, no z-fighting, no floating props, no navmesh gaps under the player.

---

## 9. Parallel build rounds with disjoint file ownership

> Lab-first amendment: for all new work, [the realtime feature-lab gate](../../docs/feature-lab.md) supersedes any direct-to-final-world ordering below. Each isolatable feature gets a lab fixture and root lab acceptance before a later final-world integration step. Only authored full-world behavior may use a recorded exception, and reusable local pieces still use the lab.

Round 0 is root-only, per AGENTS.md rules 3 and 4. Rounds 1 through 7 map to the seven vertical proofs in the brief. Each round ends with the root running the whole-game checks. Nobody proceeds on a failed round.

**Round 0, root only, no parallel work.**
Owns: `main.ts`, `contracts.ts`, `app/*`, `core/*`, `state/*`, `content/index.ts`, `content/validate.ts`, `content/xp.ts`, `content/skills.ts`, `render/renderer.ts`, `render/assets.ts`, `api/gameApi.ts`, `persistence/*`, `debug/gameDebug.ts`.
Deliverable: the game boots in Chromium, renders an empty scene with a controllable camera, Rapier and recast are initialised, the store exists, `__gameDebug.ready()` returns true, and `contracts.ts` is frozen.
Exit: A1 passes.

**Round 1, proof 1: world, movement, navigation.**

| Worker | Files | Deliverable |
| --- | --- | --- |
| A1 | `content/regions.ts`, `world/entities.ts`, `world/spatial.ts`, `world/regionBuilder.ts`, `world/interactions.ts` | Three regions built from data, semantic entities constructed, spatial queries |
| A2 | `systems/movement.ts`, `systems/navigation.ts`, `systems/physics.ts`, `render/scene.ts`, `render/camera.ts`, `render/materials.ts`, `render/entityViews.ts`, `world/scatter.ts` | Navmesh pathing, character controller, camera, tier materials, instanced scatter |
| A4 | `input/mouse.ts`, `input/keyboard.ts`, `input/picking.ts`, `ui/contextMenu.ts`, `ui/styles.css` | Click-to-move, WASD, hover and selection, context menu |

Exit: A2 to A5, B1 to B6. Screenshots `spawn`, `town_entrance`, `town_center`.

**Round 2, proof 2: gathering loop.**

| Worker | Files | Deliverable |
| --- | --- | --- |
| B1 | `content/resources.ts`, `systems/gathering.ts` | Node definitions for tiers 1, 5, 10, the gather tick, depletion, respawn |
| B2 | `systems/inventory.ts`, `systems/bank.ts` | 28 slots, stacking rules, 400-slot bank |
| B4 | `ui/hud.ts`, `ui/inventoryPanel.ts`, `ui/skillsPanel.ts`, `ui/bankPanel.ts` | HUD, inventory, skills, bank panels |

Exit: C1 to C8. Screenshots `bracken_pit`, `palewood_copse`, `redsill_shallows`, `bank_interior`.

**Round 3, proof 3: production loop.**

| Worker | Files | Deliverable |
| --- | --- | --- |
| C1 | `content/items.ts`, `content/equipment.ts`, `content/recipes.ts`, `content/shops.ts` | The full tier 1/5/10 item, gear, recipe, and shop tables |
| C2 | `systems/production.ts`, `systems/equipment.ts`, `systems/economy.ts` | Batch production, burn chance, equip rules, buy and sell |
| C3 | `ui/equipmentPanel.ts`, `ui/shopPanel.ts`, `ui/tooltips.ts` | Equipment panel with stat deltas, shop, item tooltips |

Exit: D1 to D9.

**Round 4, proof 4: combat loop.**

| Worker | Files | Deliverable |
| --- | --- | --- |
| D1 | `content/enemies.ts`, `content/spells.ts` | 9 enemies across 4 families, Ordrun with two phases, 3 spells |
| D2 | `systems/combat.ts`, `systems/enemyAI.ts`, `systems/health.ts`, `systems/death.ts` | Accuracy and damage rolls, aggro and leash, regen, death and recovery cache |
| D3 | `render/characterRig.ts`, `render/vfx.ts` | Animation blending, damage numbers, XP drops, spell effects, boss telegraph decal |

Exit: E1 to E10. Screenshots `combat_normal`, `boss_ordrun_phase2`.

**Round 5, proof 5: quests, dialogue, agility.**

| Worker | Files | Deliverable |
| --- | --- | --- |
| E1 | `content/npcs.ts`, `content/quests.ts`, `content/dialogue.ts` | 12 NPCs, 9 quests including the 7-stage Long Cairn, all dialogue trees |
| E2 | `systems/quests.ts`, `systems/dialogue.ts` | Stage predicates, reward application, dialogue traversal |
| E3 | `ui/dialoguePanel.ts`, `ui/questPanel.ts` | Dialogue and quest UI |
| A3 | `systems/agility.ts` | 9 obstacles, success roll, fail damage, traversal |

Exit: F1 to F7. Screenshots `marchfield`, `rootfall_hamlet`, `karrowmoor_terraces`, `highcairn_outpost`, `gravelmaw_entrance`, `gravelmaw_chamber2`.

**Round 6, proof 6: agent interface.**

| Worker | Files | Deliverable |
| --- | --- | --- |
| F1 | `api/observation.ts`, `agent/webmcp.ts`, `agent/tools.ts`, `agent/events.ts` | Discovery gating, the 16 tools, the ring buffer, long-poll waiters |
| F2 | `render/overlays.ts` | Highlight, path, marker, label |
| F3 | `api/docs.ts`, `ui/journalPanel.ts` | Generated docs plus the search index, Locations panel |

Exit: F9 to F14. Screenshot `overlay_showcase`.

**Round 7, integration, root-led with two workers.**
Everything wired together, content balance passes against the section 2 tables, the dungeon and boss integrated with The Long Cairn, and the two gate proofs run end to end.
Exit: F8, F15, F16, the full screenshot set, and the whole acceptance suite green.

**Ownership rules for every round.**
No two workers in the same round touch the same file. A worker who needs a `contracts.ts` change stops and reports rather than editing it. Content files are owned by exactly one worker per round, so `content/items.ts` belongs to C1 in round 3 and is read-only for everyone else afterwards. Only the root runs whole-game checks while a round is active.

---

## 10. Contradictions in the brief and risky assumptions

### Contradictions

**C1. Every Phase 1 system versus a Phase 1 that is meant to be a proof.**
The brief calls Phase 1 "prove Corealm" and then lists 30+ systems as required, including quests, a dungeon, a boss, documentation, WebMCP, agent events, and overlays. Building all of that at content depth for three regions is not a proof, it is most of the game. My reading: Phase 1 builds every system's *architecture* at tier 1/5/10 content depth, and content breadth is what Phases 2 and 3 add. Section 0 cuts what does not test that. The root should confirm this reading before round 1, because if Phase 1 is meant to be broader, the round plan needs a fourth and fifth worker per round.

**C2. "Melee (physical accuracy, damage, defense)" versus a separate defence stat.**
The brief gives Melee three jobs and originally listed exactly 11 skills. The farming-retirement amendment makes the shipped count 10. Any implementation with a separate Defence skill would add an unapproved eleventh skill. Physical defence therefore equals Melee level and magical defence equals Magic level. Consequence worth flagging: a pure-Magic character has low physical defence, which makes them fragile against melee enemies. That is a real balance property, not an accident, and Ordrun's magicArmour of only 18 exists so a magic build has a viable route through the boss.

**C3. Health is derived, but the brief also wants food and death to matter.**
Derived health from `(melee + magic) / 2` means a level 1 magic-only character has 23 HP and dies to almost anything. That is fine and classic, but it means the tier 1 enemies must be genuinely weak. Rill Skitterling at 6 HP with maxHit 2 is calibrated for exactly that.

**C4. "Nodes create circuits where early nodes respawn as later ones deplete" versus tier 10 respawn timers.**
At tier 10 (43 s respawn, 8 to 14 yields, 6.0 s per yield at the requirement level) a 5-node cluster always holds, so the circuit never actually creates tension. I made this deliberate rather than accidental: the 3-node Upper Karrow seam genuinely runs dry above Mining 20, which is what makes the two-seam choice in section 2.8 real. If the root wants circuit pressure at every tier, respawn timers need to roughly double and the section 2.8 numbers change.

**C5. Resource yield bands.**
The brief says roughly 8 to 15 low tier, 6 to 12 mid, 4 to 10 high. My formula gives 9 to 15 at tier 1, 6 to 12 at tier 50, and 4 to 10 at tier 99, which fits the mid and high bands exactly and is one off at the bottom of the low band. If the root wants exactly 8 to 15, change the min constant from 9 to 8.

### Risky assumptions

**A1. The 9 harness-required `__gameDebug` methods.**
I was instructed not to read `tools/`, so I proposed the nine methods in section 7.6 from what a Playwright harness structurally needs: `ready`, `getState`, `getVersion`, `setPaused`, `step`, `getMetrics`, `getErrors`, `waitForIdle`, `reset`. If `tools/` already expects different names or signatures, the root must reconcile before round 0 freezes. This is the single highest-risk item in the document, because every acceptance criterion in section 8 calls these names.

**A2. WebMCP specification stability.**
The brief says to research the current official WebMCP spec before building the adapter. I could not browse, so `agent/webmcp.ts` is specified as a thin adapter over a stable internal tool table, with three properties that survive any spec change: the tool table itself has no WebMCP types in it, `__gameDebug.callTool` invokes the same table without WebMCP, and event delivery is cursor plus long-poll rather than push. If the shipping spec supports notifications, push is added on top. If registration turns out to look nothing like what round 6 assumes, only `agent/webmcp.ts` changes. The root should still do the spec research before round 6 starts.

**A3. recast-navigation across three regions with 62 m of verticality.**
Karrowmoor's terraces and the Gravelmaw interior are the hardest navmesh case in Phase 1. I assumed baked `.bin` navmeshes shipped in `game/public/nav/` with runtime bake as a fallback, and off-mesh links for every agility obstacle. If off-mesh links do not behave, agility shortcuts stop being real routes and section 2.8's flip disappears, which removes a pillar. Round 1 should prove B3 (a single navmesh path from Coldbrace bank to the Upper Karrow seam) before anyone builds content on top of it.

**A4. Quaternius asset coverage for tier 10 and the dungeon.**
Medieval Village and Stylized Nature cover Fallowmarch and Vellenwood comfortably. Karrowmoor's terraces, the Gravelmaw interior, and Ordrun himself are the coverage risk. If no free pack has a suitable stone construct, the fallback is a Universal Base Character with a stone material treatment and a scale of 1.8, which reads acceptably at boss distance. This should be checked during round 0 asset manifest work, not discovered in round 4.

**A5. XP curve pacing against the agent proof.**
Mining 1 to 10 takes about 13 minutes of real time. That is deliberate and correct for the game, but it makes the F17 agent proof a 13-minute test. The proof allows `setTimeScale` and nothing else. If the root wants the proof to run at real speed, budget 15 minutes of CI time for it.

**A6. 60 FPS in Vellenwood.**
Dense canopy at 1 prop per 8 m² is the worst case in Phase 1. The 400-draw-call budget assumes aggressive instancing per (asset, material variant) pair. If tier materials fragment the instancing (three tiers x four families x three regions is 36 material variants), draw calls climb fast. Round 1 must measure A5 with real canopy density before round 5 adds quest props on top.

**A7. localStorage size.**
A fully progressed Phase 1 save is roughly 40 KB, well under the 5 MB quota. The risk is `world.nodes` and `discovery.entities` growing to one entry per entity across three regions, which is a few thousand keys. I assumed that stays under 100 KB. If it does not, node state compresses to a delta against content defaults.

---

## Root-review checklist

### Scope to cut

Confirm or reverse each of these before freezing contracts. Every one of them is a real reduction in Phase 1 work.

1. **Internal AI (Assist / Copilot / Autonomous).** Not gate-checked. Roughly one full worker-round of savings. Cut unless the root reads the gate differently.
2. **Minimap.** Replaced by the compass strip plus the Journal panel. Saves a render pass and a whole art task.
3. **Boss complexity beyond two phases and one telegraph.** Ordrun proves the telegraph system. More phases are Phase 2 content.
4. **Shop restocking, price drift, bank tabs, fuzzy search.** Fixed prices and a substring filter cover every test in section 8.
5. **Overlay kinds beyond four.** Highlight, path, marker, and label are enough for `overlay_showcase` and for an agent to build an assistant experience.
6. **Content tiers 20 to 99.** Schemas carry `tier: number` and nothing else changes. Zero cost to defer.

If any of these come back in, the round plan in section 9 needs a rebalance, not just an extra task.

### Contracts to verify before freezing `contracts.ts`

1. **`__gameDebug` names against `tools/`.** Assumption A1. Highest risk in the document. Reconcile the nine harness methods before round 0 ends, because all 40+ acceptance criteria call them by name.
2. **`GameApi` is genuinely the only write path.** Confirm that `ui/*`, `agent/tools.ts`, and `debug/gameDebug.ts` all route through it. If any UI panel writes the store directly, agent parity is dead and section 8's F11 becomes untestable.
3. **`SemanticEntity` covers all 16 archetypes** without an escape hatch beyond `meta`. If a worker needs a new top-level field, that is a root change under AGENTS.md rule 5.
4. **`ActivityState` really is one-at-a-time,** and combat sits outside it. The player must be able to eat while auto-attacking, or Ordrun is unwinnable.
5. **Event `data` shapes are exact.** Section 7.5 gives the field list per type. Agents will depend on these, and a loose `Record<string, unknown>` in practice becomes an undocumented API.
6. **`Result<T>` everywhere, no thrown errors across the API boundary.** WebMCP tools must return errors as values.
7. **The XP table is computed once and frozen.** Verify `totalXpAt(99) === 9999879` in a unit test so a refactor cannot silently change the curve.
8. **Update order in section 3.** Events flush at step 14, after quests at step 12, so a `level.gained` and the `quest.updated` it triggers land in the same tick and in that order.

### First playable proof

The single thing to build before anything else, and the thing that decides whether the rest of the plan holds:

**Stand in Coldbrace. Right-click a Grithe ore node in the Bracken Pit 160 m away. Watch the player path there over a real navmesh. Watch four ore appear one at a time, one every six seconds. Watch Mining hit level 2 at 99 XP. Watch the node go grey and empty. Walk back to the bank and deposit.**

That single run exercises: content loading and validation, the semantic entity layer, navmesh pathing, the character controller, the activity system, the gather tick, the seeded RNG, the XP curve, level-up, the depletion and respawn timer, inventory slots, the bank, the event queue, and `__gameDebug` state comparison. If it works through a mouse click and produces an identical result through `callTool("corealm_interact", ...)`, the architecture is proven and rounds 3 through 7 are content and systems on top of a known-good base.

If it does not work, nothing after it matters.

## September 10 deep Wilderness amendment

The user's implementation request approves the T50/T70 Wilderness expansion, five merged-magic rune keepers, 7�15 creature packs, universal miniboss scaling, adult and baby dragon families, high-tier gathering and equipment materials described in docs/deep-wilderness-round.md. That document records the frozen depth contract and acceptance workflow.

