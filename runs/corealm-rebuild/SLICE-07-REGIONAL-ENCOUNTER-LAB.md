# Slice 07 — Regional encounter lab

Representative regional packs proven through the production `?mode=combat&rpg=1&pack=<id>` fixture
on real hardware Chromium (ANGLE D3D11, 1440x900). Semantic browser state is the evidence;
screenshots are inspected review material. This is lab acceptance of pack behaviour. It does not
activate the final-world population, which stays gated in `content/regionalPackActivation.ts`.

Every pack here resolves its model and measurements from `game/public/assets/manifest.json` — the
same bytes the final world loads. Nothing is proven against a staged candidate catalogue.

```
PORT=4183 node runs/corealm-rebuild/checks/stable-server.mjs
node --import tsx tools/regional-pack-lifecycle-test.ts --url http://127.0.0.1:4183 --pack <id>
bash runs/corealm-rebuild/checks/regional-pack-lifecycle-batch.sh <id> <id> ...   # one GPU slot, serial
node tools/regional-pack-lifecycle-summary.mjs [--matrix]
node --import tsx tools/regional-pack-activation-list.mjs
```

One run per invocation, serial, ~80 s each, 240 s hard budget. Evidence lands in
`test-results/regional-pack-lifecycle/<pack>/` (`patrol.png`, `attack.png`, `corpse.png`,
`respawn.png`, `failure.png` on a failed run, `report.json`). That directory is disposable and
gitignored; the set below rebuilds it in about 40 minutes and occupies 136 MB.

All measurements were taken against the navmesh regenerated for `NAV_CONFIG.walkableClimb = 8`
(fingerprint 9610adac) and the pursuit speeds capped by run-clip cadence. Earlier results in this
slice used the looser climb and the flat 4.68 m/s pursuit; they were discarded and re-run.

## What one run proves

In order, against production AI, combat, loot and respawn, on the normal clock (`timeScale === 1`):

1. **registered** — the fixture is the requested pack; every resident is alive at full health, drawn
   with the pack's asset, named plainly, labelled with a real computed combat level (no `T<n>`
   tokens), and spawned with clear space between bodies.
2. **patrol** — natural idle/patrol inside the habitat: residents move, bodies never overlap, no
   body overruns the habitat radius, and the setting stays inside the ring the residents circle.
3. **aggro** — residents initiate or answer, and leave their spawn to pursue.
4. **damage** — enemy damage lands, within the authored max hit, at the attack clip's contact
   marker. Ranged and magic residents also damage from standoff distance; the matrix shows
   `pass (3/4)` for melee packs because that last check does not apply to them.
5. **flinch** — a masked hit overlay on a surviving resident the player strikes.
6. **kill** — the attack command kills the target, melee XP rises, the natural coin roll pays out.
7. **loot** — when the drop table rolls a pile, the player reaches it, takes it through the real
   interaction, and the item names are plain. `-` means the natural roll produced nothing, which is
   ordinary at a 15% drop chance.
8. **return** — the player breaks off past the production pursue radius and every survivor leashes,
   walks home inside the habitat and reaches full health.
9. **respawn** — respawn on the normal `ENEMY_RESPAWN_MS` clock at the spawn point at full health,
   survivors resume the authored circuit in order, and the pack clears any body overlap the respawn
   created.
10. **clean** — no game, page or console errors.

## Pack x check matrix

| Pack | Species | Setting | Style | registered | patrol | aggro | damage | flinch | kill | loot | return | respawn | clean |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| fallowmarch_kiln_track_east_watch | goblin_shaman | supply-camp | magic | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass |
| fallowmarch_kiln_track_west_patrol | goblin_scout | supply-camp | melee | pass | pass | pass | pass (3/4) | pass | pass | - | pass | pass | pass |
| fallowmarch_lone_palewood_west_scrub | (wildlife) | undressed | melee | pass | pass | pass | pass (3/4) | pass | pass | pass | pass | pass | pass |
| fallowmarch_northgate_west_scrub | zombie | burial-shrine | melee | pass | pass | pass | pass (3/4) | pass | pass | - | **FAIL** | - | - |
| fallowmarch_open_march_west_pack | (wildlife) | undressed | melee | pass | pass | pass | pass (3/4) | pass | pass | pass | pass | pass | pass |
| fallowmarch_palewood_east_brush | zombie | burial-shrine | melee | pass | pass | pass | pass (3/4) | pass | pass | - | pass | pass | pass |
| fallowmarch_palewood_northwest_watch | goblin_archer | supply-camp | ranged | pass | pass | pass | pass | pass | pass | - | pass | pass | pass |
| vellenwood_cairn_gate_east_brush | skeleton_archer | burial-shrine | ranged | pass | pass | pass | pass | pass | pass | - | pass | pass | pass |
| vellenwood_gorge_ford_south_hunting_ground | wraith | roost | melee | pass | pass | pass | pass (3/4) | pass | pass | pass | pass | pass | pass |
| vellenwood_gorge_watch_northeast_roots | beetle_golem | burial-shrine | melee | pass | pass | pass | pass (3/4) | pass | pass | - | pass | pass | pass |
| vellenwood_marchgate_south_bramble | webweaver_spider | undressed | melee | pass | pass | pass | pass (3/4) | pass | pass | - | pass | pass | pass |
| vellenwood_marchgate_south_damp_roots | grave_ghoul | burial-shrine | melee | pass | pass | pass | pass (3/4) | pass | pass | - | **FAIL** | - | - |
| vellenwood_marchgate_south_rootshade | skeleton_soldier | burial-shrine | melee | pass | pass | pass | pass (3/4) | pass | pass | - | **FAIL** | - | - |
| vellenwood_mossbound_west_bramble | marsh_wasp | undressed | melee | pass | pass | pass | pass (3/4) | pass | pass | - | pass | pass | pass |
| vellenwood_rootfall_south_open_glade | skeleton_soldier | supply-camp | melee | pass | pass | pass | pass (3/4) | pass | pass | - | **FAIL** | - | - |
| vellenwood_rootfall_south_stump_hollow | mossback_sentinel | undressed | melee | pass | pass | pass | pass (3/4) | pass | pass | - | pass | pass | pass |
| karrowmoor_far_tarn_north_east_watch | iron_golem | supply-camp | melee | pass | pass | pass | pass (3/4) | pass | pass | - | pass | pass | pass |
| karrowmoor_gravelmaw_north_west_quills | (wildlife) | undressed | melee | pass | pass | **FAIL** | - | - | - | - | - | - | - |
| karrowmoor_highcairn_south_wall_mandibles | stone_golem | stone-working | melee | pass | pass | pass | pass (3/4) | pass | pass | - | pass | pass | pass |
| karrowmoor_north_east_moor_nightmares | iron_golem | ritual-court | melee | pass | pass | pass | pass (3/4) | pass | pass | - | pass | pass | pass |
| karrowmoor_ridge_south_nightmares | shale_elemental | roost | melee | pass | pass | pass | pass (3/4) | pass | pass | - | pass | pass | pass |
| karrowmoor_western_cairn_bighorns | (wildlife) | undressed | melee | pass | pass | pass | pass (3/4) | pass | pass | pass | pass | pass | pass |
| kilnhalt_clinker_north_inner | (wildlife) | undressed | melee | pass | pass | pass | pass (3/4) | pass | pass | pass | pass | pass | pass |
| kilnhalt_clinker_south_scrub | skeleton_mage | ritual-court | magic | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass |
| kilnhalt_clinker_southern_approach_west | lava_golem | ritual-court | melee | pass | pass | pass | pass (3/4) | pass | pass | - | pass | pass | pass |
| kilnhalt_clinker_southwest_inner | plague_zombie | burial-shrine | melee | pass | pass | pass | pass (3/4) | pass | pass | - | pass | pass | pass |
| kilnhalt_clinker_west_boundary | fire_golem | roost | melee | pass | pass | pass | pass (3/4) | pass | pass | - | pass | pass (2/4) | - |
| kilnhalt_kilnroad_north_inner | fire_golem | stone-working | melee | pass | pass | - | - | - | - | - | - | - | - |
| kilnhalt_kilnroad_toll_northwest | banshee | burial-shrine | magic | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass |

## Per-region results

Region order matches the orchestrator's activation order. A group is one species in one setting
recipe; proving its representative proves the combination, and packs sharing it inherit that
evidence. A pack that failed on its own evidence is held even when a sibling passed, because the
sibling proves the combination and not that pocket.

### Fallowmarch

| Species | Family | Setting | Style | Packs | Representative | Result | Individually held |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Goat (wildlife) | wildlife | undressed | melee | 1 | pack_fallowmarch_open_march_west_pack | proven |  |
| goblin_archer | goblin | supply-camp | ranged | 4 | pack_fallowmarch_palewood_northwest_watch | proven |  |
| goblin_scout | goblin | supply-camp | melee | 8 | pack_fallowmarch_kiln_track_west_patrol | proven |  |
| goblin_shaman | goblin | supply-camp | magic | 3 | pack_fallowmarch_kiln_track_east_watch | proven |  |
| Red Fox (wildlife) | wildlife | undressed | melee | 2 | pack_fallowmarch_lone_palewood_west_scrub | proven |  |
| Wild Horse (wildlife) | wildlife | undressed | melee | 2 | - | not exercised |  |
| zombie | zombie | burial-shrine | melee | 4 | pack_fallowmarch_palewood_east_brush | proven | held: pack_fallowmarch_northgate_west_scrub |

Accepted, species and setting both proven (21): pack_fallowmarch_open_march_west_pack, pack_fallowmarch_palewood_northwest_watch, pack_fallowmarch_northgate_outer_raiders, pack_fallowmarch_bracken_west_outer_watch, pack_fallowmarch_corven_ford_southwest_pack, pack_fallowmarch_galeskin_east_wolf_ground, pack_fallowmarch_kiln_track_west_patrol, pack_fallowmarch_bracken_southeast_patrol, pack_fallowmarch_marchfield_east_wolf_ground, pack_fallowmarch_coldbrace_northwest_raiders, pack_fallowmarch_palewood_north_outer_pack, pack_fallowmarch_coldbrace_southwest_pack, pack_fallowmarch_palewood_far_south_scrub, pack_fallowmarch_kiln_track_east_watch, pack_fallowmarch_bracken_northeast_spiders, pack_fallowmarch_air_cache_southeast_spiders, pack_fallowmarch_lone_palewood_west_scrub, pack_fallowmarch_palewood_north_scrub, pack_fallowmarch_palewood_east_brush, pack_fallowmarch_palewood_south_warm_ground, pack_fallowmarch_corven_ford_southeast_pack

Not exercised, no representative run (2): pack_fallowmarch_northern_horse_outer_grass, pack_fallowmarch_south_march_horse_grass

Failed, do not activate (1): pack_fallowmarch_northgate_west_scrub

### Vellenwood

| Species | Family | Setting | Style | Packs | Representative | Result | Individually held |
| --- | --- | --- | --- | --- | --- | --- | --- |
| beetle_golem | golem | burial-shrine | melee | 1 | pack_vellenwood_gorge_watch_northeast_roots | proven |  |
| grave_ghoul | zombie | burial-shrine | melee | 2 | pack_vellenwood_marchgate_south_damp_roots | FAILED |  |
| grave_ghoul | zombie | supply-camp | melee | 1 | - | not exercised |  |
| marsh_wasp | wasp | undressed | melee | 1 | pack_vellenwood_mossbound_west_bramble | proven |  |
| mossback_sentinel | forest_creature | undressed | melee | 1 | pack_vellenwood_rootfall_south_stump_hollow | proven |  |
| Pig (wildlife) | wildlife | undressed | melee | 1 | - | not exercised |  |
| skeleton_archer | skeleton | burial-shrine | ranged | 2 | pack_vellenwood_cairn_gate_east_brush | proven |  |
| skeleton_archer | skeleton | supply-camp | ranged | 3 | - | not exercised |  |
| skeleton_soldier | skeleton | burial-shrine | melee | 2 | pack_vellenwood_marchgate_south_rootshade | FAILED |  |
| skeleton_soldier | skeleton | supply-camp | melee | 3 | pack_vellenwood_rootfall_south_open_glade | FAILED |  |
| webweaver_spider | spider | undressed | melee | 1 | pack_vellenwood_marchgate_south_bramble | proven |  |
| wraith | wraith | burial-shrine | melee | 2 | - | not exercised |  |
| wraith | wraith | roost | melee | 2 | pack_vellenwood_gorge_ford_south_hunting_ground | proven |  |
| wraith | wraith | supply-camp | melee | 2 | - | not exercised |  |

Accepted, species and setting both proven (8): pack_vellenwood_gorge_watch_northeast_roots, pack_vellenwood_mossbound_west_bramble, pack_vellenwood_rootfall_south_stump_hollow, pack_vellenwood_cairn_gate_east_brush, pack_vellenwood_rootfall_west_rootpocket, pack_vellenwood_marchgate_south_bramble, pack_vellenwood_gorge_ford_south_hunting_ground, pack_vellenwood_east_clearing_hunting_ground

Not exercised, no representative run (9): pack_vellenwood_blackwater_southeast_bramble, pack_vellenwood_thornline_north_bramble, pack_vellenwood_rootfall_southwest_brush, pack_vellenwood_cairn_gate_east_boundary_thicket, pack_vellenwood_rootfall_south_wall_thicket, pack_vellenwood_cairn_gate_far_east_roots, pack_vellenwood_ember_edge_far_east_roots, pack_vellenwood_mossbound_northeast_roots, pack_vellenwood_earth_cache_northwest_brush

Failed, do not activate (7): pack_vellenwood_marchgate_south_damp_roots, pack_vellenwood_root_tunnel_south_brush, pack_vellenwood_marchgate_south_rootshade, pack_vellenwood_mossbound_north_bramble, pack_vellenwood_rootfall_south_open_glade, pack_vellenwood_blackwater_southwest_fern_bed, pack_vellenwood_gorge_ford_east_glade

### Karrowmoor

| Species | Family | Setting | Style | Packs | Representative | Result | Individually held |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Bighorn Sheep (wildlife) | wildlife | undressed | melee | 1 | pack_karrowmoor_western_cairn_bighorns | proven |  |
| Bustard (wildlife) | wildlife | undressed | melee | 1 | - | not exercised |  |
| iron_golem | golem | ritual-court | melee | 2 | pack_karrowmoor_north_east_moor_nightmares | proven |  |
| iron_golem | golem | roost | melee | 1 | - | not exercised |  |
| iron_golem | golem | supply-camp | melee | 4 | pack_karrowmoor_far_tarn_north_east_watch | proven |  |
| Porcupine (wildlife) | wildlife | undressed | melee | 1 | pack_karrowmoor_gravelmaw_north_west_quills | FAILED |  |
| shale_elemental | elemental | roost | melee | 1 | pack_karrowmoor_ridge_south_nightmares | proven |  |
| shale_elemental | elemental | stone-working | melee | 1 | - | not exercised |  |
| Stag Beetle (wildlife) | wildlife | undressed | melee | 1 | - | not exercised |  |
| stone_golem | golem | roost | melee | 3 | - | not exercised |  |
| stone_golem | golem | stone-working | melee | 2 | pack_karrowmoor_highcairn_south_wall_mandibles | proven |  |
| stone_golem | golem | supply-camp | melee | 6 | - | not exercised |  |

Accepted, species and setting both proven (10): pack_karrowmoor_western_cairn_bighorns, pack_karrowmoor_north_east_moor_nightmares, pack_karrowmoor_west_moor_outer_mandibles, pack_karrowmoor_far_tarn_north_east_watch, pack_karrowmoor_moor_road_far_west_watch, pack_karrowmoor_great_cairn_south_west_quills, pack_karrowmoor_upper_seam_south_watch, pack_karrowmoor_ridge_south_nightmares, pack_karrowmoor_highcairn_south_wall_mandibles, pack_karrowmoor_water_cache_west_stalkers

Not exercised, no representative run (13): pack_karrowmoor_upper_moor_east_bustards, pack_karrowmoor_scree_slide_west_nightmares, pack_karrowmoor_outer_tarn_track_nightmares, pack_karrowmoor_far_tarn_south_east_mandibles, pack_karrowmoor_tarn_track_east_mandibles, pack_karrowmoor_second_ramp_west_watch, pack_karrowmoor_tideworn_east_watch, pack_karrowmoor_moor_east_gate_watch, pack_karrowmoor_far_tarn_east_moor_stalkers, pack_karrowmoor_water_road_east_watch, pack_karrowmoor_moor_road_inner_watch, pack_karrowmoor_scree_slide_far_west_scorpions, pack_karrowmoor_lower_terrace_west_watch

Failed, do not activate (1): pack_karrowmoor_gravelmaw_north_west_quills

### Kilnhalt

| Species | Family | Setting | Style | Packs | Representative | Result | Individually held |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Armored Dragon (wildlife) | wildlife | undressed | melee | 1 | - | not exercised |  |
| banshee | wraith | burial-shrine | magic | 2 | pack_kilnhalt_kilnroad_toll_northwest | proven |  |
| banshee | wraith | ritual-court | magic | 1 | - | not exercised |  |
| fire_golem | golem | roost | melee | 1 | pack_kilnhalt_clinker_west_boundary | FAILED |  |
| fire_golem | golem | stone-working | melee | 2 | pack_kilnhalt_kilnroad_north_inner | FAILED |  |
| Giant Centipede (wildlife) | wildlife | undressed | melee | 1 | pack_kilnhalt_clinker_north_inner | proven |  |
| lava_golem | elemental | ritual-court | melee | 1 | pack_kilnhalt_clinker_southern_approach_west | proven |  |
| plague_zombie | zombie | burial-shrine | melee | 2 | pack_kilnhalt_clinker_southwest_inner | proven |  |
| revenant | wraith | burial-shrine | melee | 2 | - | not exercised |  |
| revenant | wraith | ritual-court | melee | 4 | - | not exercised |  |
| skeleton_mage | skeleton | burial-shrine | magic | 2 | - | not exercised |  |
| skeleton_mage | skeleton | ritual-court | magic | 5 | pack_kilnhalt_clinker_south_scrub | proven |  |

Accepted, species and setting both proven (11): pack_kilnhalt_kilnroad_toll_northwest, pack_kilnhalt_ashfin_southeast_open, pack_kilnhalt_clinker_north_inner, pack_kilnhalt_clinker_southern_approach_west, pack_kilnhalt_clinker_southwest_inner, pack_kilnhalt_kilnroad_southwestern_edge, pack_kilnhalt_clinker_south_scrub, pack_kilnhalt_emberhorn_west_range, pack_kilnhalt_ashback_northeast_range, pack_kilnhalt_cinderpine_outer_east, pack_kilnhalt_cinderpine_northwest_outer

Not exercised, no representative run (10): pack_kilnhalt_emberfast_north_outer, pack_kilnhalt_emberfast_northwest_outer, pack_kilnhalt_kilnroad_northwest_gap, pack_kilnhalt_ashback_far_north, pack_kilnhalt_clinker_southern_approach_east, pack_kilnhalt_emberhorn_east_range, pack_kilnhalt_cinderpine_west_gap, pack_kilnhalt_clinker_northern_edge, pack_kilnhalt_clinker_southwest_outer, pack_kilnhalt_ashback_east_outer

Failed, do not activate (3): pack_kilnhalt_clinker_west_boundary, pack_kilnhalt_kilnroad_north_inner, pack_kilnhalt_ashfin_outer_east

## Defects found

### Production: a returning resident is trapped by the setting at the habitat centre

Seen on four packs across two recipes: `pack_fallowmarch_northgate_west_scrub` (Zombie, burial
shrine), `pack_vellenwood_marchgate_south_damp_roots` (Grave Ghoul, burial shrine),
`pack_vellenwood_marchgate_south_rootshade` (Skeleton Soldier, burial shrine) and
`pack_vellenwood_gorge_ford_south_hunting_ground` (Wraith, roost). After the pack leashes, one
resident stops dead 1.2–2.2 m from the habitat centre and stays in `returning` at full health for
the rest of the run, with its spawn anchor 8 m away on the far side of the setting. `failure.png`
shows it pressed against the offering table.

Cause: `EnemyAiSystem.stepToward` walks a returning resident straight at its spawn anchor and, when
the direct step is blocked, tries one single-axis slide per axis. The burial shrine puts
`offering-table` at centre `z - 0.6`, `chapel-remnant` at `z - 1.9` and the two grave markers at
`z + 0.25`, `x ± 1.7`, which leaves a pocket immediately north of the altar between the markers.
Neither slide escapes it. The comment on that code says as much: it is deliberately "cheap,
deterministic, and gets around the ordinary building and rock corners", not a path query.

It is intermittent and not species-specific — it depends on where a resident happens to disengage.
`pack_vellenwood_gorge_ford_south_hunting_ground` failed once and passed on retry;
`pack_fallowmarch_palewood_east_brush` uses the same recipe and species as the failing zombie pack
in a 10 m pocket and settles cleanly, while the 9 m pocket with 7 residents traps one.

Not fixed here. Both plausible fixes are outside this slice's file ownership:

- widen the setting's rear gap in `content/encounterDressing.ts` and regenerate the frozen
  coordinates in `content/regionalPackLayout.ts` — both are frozen authored data per
  `PACK-INTEGRATION.md`, so root owns that decision; or
- give `stepToward` a real detour for habitat movers in `systems/enemyAI.ts`, a shared file.

The same pocket exists in the final world for all 81 dressed packs. It needs a decision before
activation, and it is the single largest reason packs are held below.

### Production: a Skeleton Soldier pack pins the player

`pack_vellenwood_rootfall_south_open_glade` (Skeleton Soldier, supply camp, radius 12, 6 residents).
After the kill, six consecutive `corealm_stop` + `corealm_move_to` commands each report `arrived`
while the player never leaves `(-69.8, 27.4)` — 3.4 m from the habitat centre, surrounded by five
aggro skeletons at 2.8–5.4 m. Told to walk to `(-72, 78)`, it ends the command where it started.
`navigation.completed` fires without the player moving, so the agent tool reports success.

The player is at melee 90 with a Titanium Sword and full health throughout, so this is not a
survivability problem: a closed melee ring keeps the player in place and the navigation reports
arrival anyway. Every other melee pack proven here disengages in a few seconds.

Not fixed here: it lives in `systems/combat.ts` pursue, `systems/movement.ts` navigation completion
or agent `operations.ts`, all outside this slice.

### Production: Fire Golem packs do not complete a lifecycle

`pack_kilnhalt_kilnroad_north_inner` (stone working, 5 at radius 10) reaches aggro — one resident
goes `aggro` and stays there — but no enemy damage reaches the player in the whole 40 s window, on
three separate runs. `pack_kilnhalt_clinker_west_boundary` (roost, 5 at radius 16) gets much
further: it kills, loots, leashes and respawns correctly, then fails `survivorsResumeRanging`
because the golems have not covered enough of their circuit in 30 s.

Both use `creature_lava_golem`. The aggressive `lava_golem` species on the same asset
(`pack_kilnhalt_clinker_southern_approach_west`) passes end to end, so this is the territorial
provocation path plus a very large slow body, not the art. Worth re-checking with a longer resume
window and a provocation from outside melee reach.

### Fixture limit: a 6 m pocket cannot demonstrate pursuit

`pack_karrowmoor_gravelmaw_north_west_quills` (Porcupine, territorial, 5 residents at radius 6) is
the tightest pocket in the roster. The provoking player is already inside the residents' reach, so
none of them ever leaves its spawn and `residentsPursuePlayer` fails on a technicality rather than a
defect. Its patrol minimum body gap is also the tightest measured anywhere, at -0.006 m.
`pack_karrowmoor_western_cairn_bighorns` covers territorial wildlife instead, at radius 9.

### Visual: `altar_ruins_altar` reads as a black box

The offering table and ritual altar are the same asset. At the patrol camera it is a featureless
black rectangle, and even at ground level in `corpse.png` it is near-black with one faint circular
marking. The grave markers, chapel remnant, crates, barrels, fence and whetstone all read correctly.
Two of the five setting recipes are built on it, so it is worth an art pass. Not a behaviour blocker.

### Visual: accepted, on inspection

- Iron Golem's cast-iron round 2 material reads as riveted dark plate with rust patina in a supply
  camp, at both the patrol camera and ground level. It does not read as brown rock.
- Goblin, zombie, skeleton, wraith, grave ghoul, plague zombie, banshee, stone golem, beetle golem,
  shale elemental, mossback sentinel, webweaver spider and marsh wasp bodies are all readable at
  both cameras, with plain proportions and settled corpses.
- A dead Lava Golem loses its glowing veins entirely and reads as plain grey rock. Plausible as a
  cooled corpse; flagged in case the glow was meant to persist.

### Fixture defects fixed this slice

| Defect | Symptom | Fix |
| --- | --- | --- |
| Aggro measured from the closing snapshot only | A provoked passive resident traded blows and disengaged inside the window, so `residentsInitiateOrAnswer` read 0 aggro despite `pursuitSeen` and an observed flinch | Track the peak aggro count across the window; report `residentsAggroAtClose` beside it |
| Provocation attack left running | `corealm_attack` kept swinging, so a level-1 player killed an 8 HP passive fox before the flinch and kill steps could use it | Poll until the pack answers, then `corealm_stop` |
| Disengage step had no health top-up | A Skeleton Soldier pack beat the weak lab player to death; the region respawn teleport then read as "never arrived" and hid the leash result | Top up during the walk-off and fail loudly on `playerDowned` |
| Disengage point inside the pursue radius | The lab spawn is 30 m from the habitat and production walks the player back up to `MAX_PURSUE_METRES` (32), so the player was dragged into the pack | Import the constant and break off past it, falling back to the spawn when there is no route |
| Disengage issued once | The walk-off can be cancelled, or complete without moving; a single command hid that | Reissue while the pack settles, recording where each attempt was sent and where the player ended up |
| `survivorsReturnToHabitat` asserted the literal `true` | The check could not fail; only the poll timeout could | Assert survivor count, state, full health and containment, with all of it in the report |
| Settle failure reported as a truncated timeout string | Three different causes looked identical | Deadline loop that always records player position, habitat centre, walk attempts and every survivor's state, health, containment, position and spawn anchor |
| Final body separation sampled once | A resident respawning onto its own circuit anchor lands on a survivor passing through it, because production enemy AI has no lateral body avoidance | Require the pack to clear the overlap within a bounded window; record the worst gap |
| Weapon search took the first match | The player got a tier 10 Cobalt Sword against tier 20–34 Kilnhalt residents and landed no hit at all on a level 29 plague zombie | Prefer the strongest production sword (Titanium) |
| Flinch punched at melee 1 | Thirty levels below the target nothing connects, so no hit reaction could ever be observed on a Kilnhalt pack | Match the pack's own level, still unarmed |
| Kill was one attack command | A standoff caster backs off, leaves its pursuit habitat and leashes mid-fight, ending the command with the resident alive at 11/42 | Re-engage in rounds and record the target's health trace |
| Loot take assumed reach | A Giant Centipede's pile lands outside the player's reach from where it was killed; `corealm_take_loot` answered `OUT_OF_RANGE` | Walk to the pile, retry, and assert `lootPileReachable` |
| Failed runs left no picture | Only semantic state survived | Capture `failure.png` framed on the habitat |
| Staged catalogue path | Packs could be proven against bytes the final world does not load | Removed with its pinned SHA and `--catalogue` flag; a pack whose asset is missing from the public manifest now fails |
| Mixed CRLF/LF in the helper | Edits silently failed to apply | Normalised to LF |

## Cleanup

Deleted:

- the staged-candidate installer path in `tools/regional-pack-lifecycle-test.ts`, its
  `RETAINED_CATALOGUE`/`RETAINED_SHA256` pin, the `--catalogue` flag and the now-unused
  `installAssetCandidates`, `createHash` and playwright `Page` imports;
- the `HELD_SPECIES` entry for Iron Golem, whose cast-iron round 2 material is promoted.

Added: `tools/regional-pack-lifecycle-summary.mjs`, `tools/regional-pack-activation-list.mjs` and
`runs/corealm-rebuild/checks/regional-pack-lifecycle-batch.sh`.

Not deleted: `art/rebuild/candidates/finish-bestiary` is 484 MB after slice 04's own prune. It is
that slice's to trim further, not this one's.

## Limits

- Lab acceptance only. Nothing here activates the final-world population.
- Screenshots are a compact review of formation, contact, corpse and respawn framing. They make no
  frame-cost claim and no authored-world placement claim.
- One representative pack per species x setting group. The trapped-resident defect shows behaviour
  can differ between packs of the same group, so a green group is not a guarantee for every pocket
  in it. The per-region tables name which packs were actually run.
- The generated-world spatial audit (`tools/regional-pack-world-test.ts` shards), the five dressing
  view captures and the dressed navigation recheck against the current navmesh remain root's work.
- No performance measurement was taken and none is claimed.
