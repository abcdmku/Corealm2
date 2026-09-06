# Slice 15 — Traversal and world routes

Branch `finish/slice-15-traversal`, rebased onto `main` at `9d5b6cc`. Dev/acceptance server on
port 4189 (`PORT=4189 node runs/corealm-rebuild/checks/stable-server.mjs`), real Vite, HMR off.
Every browser run below used headless Chromium with ANGLE D3D11 on the hardware renderer and
asserted that renderer before acting. Screenshots are disposable evidence under ignored
`test-results/`; they are listed by path, not committed.

**World-only exception.** Terrain, coast, world layout and long-distance navigation are proved in
the authored world rather than the feature lab, under rule 11 of `AGENTS.md` and the workflow in
`docs/world-authoring.md`. The reusable traversal presentation, contact poses and agility fixtures
keep their existing lab proof (`tools/traversal-contact-check.ts`, `?mode=combat&agility=1`).

**Navmesh regeneration is required before release.** `game/src/app/config.ts` is inside
`tools/build-navmesh.ts`'s `navigationSettings` fingerprint group, so the shipped
`game/public/generated/corealm-navmesh.bin` no longer matches and the runtime falls back to
generating the mesh at boot. Re-run `npx tsx tools/build-navmesh.ts`. No map regeneration is
needed: no authored placement moved.

## Priority 0 — the Rootfall stair regression

`tests/structure-movement-grounding.test.ts` "crosses every native Rootfall flight and returns to
world terrain" failed on main with a 0.868 m vertical step against a 0.7 m limit.

Bisected to `986616d Make coastal terrain playable and grade steep paths` (`986616d~1` passes,
`986616d` fails, later commits unchanged). That commit raised `NAV_CONFIG.walkableClimb` from 2
voxels (0.40 m) to 10 (2.00 m) so continuous steep slopes survive Recast's ledge filter. Terrain,
sources and the voxel origin at Rootfall are byte-identical either side of it — only the Recast
config changed.

Measured navmesh surface along the stair centreline, relative to the stump base at y 8.29, on flat
terrain at 8.287:

| along (m) | before 986616d | on main (climb 10) | fixed (climb 8) |
| --- | --- | --- | --- |
| 9.00 | 0.605 | 0.279 | 0.436 |
| 8.75 | 0.613 | 0.280 | 0.560 |
| 8.50 | 0.759 | 0.464 | 0.683 |
| 8.25 | 0.863 | 0.914 | 0.807 |
| 8.00 | 0.968 | 1.253 | 0.931 |
| 7.75 | 1.073 | 1.353 | 1.054 |

At climb 10 the whole 0.92 m first flight is absorbed into the ground span and the mesh jumps
0.97 m over 0.75 m of run; one 0.52 m movement tick crosses 0.868 m of it.

**Fix:** `walkableClimb: 8` (1.60 m). Recast's ledge filter drops a span when the spread between
its lowest and highest 4-neighbour exceeds `walkableClimb`, and a continuous 60-degree face rises
`0.45 * tan 60 = 0.779 m` per cell in both directions, so the real requirement is `2 * 0.779 =
1.559 m`, not 0.779 m and not 2.0 m. Swept 4, 5, 6, 7, 8: 4–7 drop the 50 and 58 degree bakes in
`tests/coastal-traversal.test.ts`; 8 bakes all three and restores the Rootfall flight as a
continuous 26-degree ramp (0.124 m per 0.25 m of run, 0.26 m per tick). Movement still refuses the
1.60 m step — `slopeStepAllowed` compares rise over run against `PLAYER_SLOPES`, and 1.60 m over
one 0.52 m tick is 72 degrees.

Commit: `Restore stair-scale navmesh detail under the 60-degree climb`.

## coastal-traversal flakiness

Not order dependence: a timeout. `keeps authored tracks below the climb limit and coastal creatures
on dry biome terrain` builds the whole authored world and takes 2.9 s alone but 5.8 s inside a full
253-file `vitest run`, over the 5 s default. Given an explicit 30 s timeout with unchanged
assertions. Commit: `Give the world-building coastal check a real timeout`.

## Traversal presentation

The world check measured 1085 ms of a visible, motionless, idle-posed actor at the Sunder Ledge
entrance before the concealing cover finished — a stationary timer in plain view, which is exactly
what package 10 was asked to remove. The cover used a fixed progress span (opaque at p = 0.18),
which is 0.36 s on the 2 s Brook Planks but 1.08 s on the 6 s Broken Ledge.

`sampleTraversal` now expresses the cover as a 0.15 s hold plus a 0.4 s fade against the
obstacle's own duration, and a concealed crossing steps from where the player stood onto the
authored entrance during that beat. `CharacterRig.syncTraversalPose` plays the start of the real
move while the cover is still transparent — `walk` into a passage mouth, otherwise the
climb/vault/balance/slide clip — and only falls back to `idle` once the screen is opaque.

Measured before and after, same obstacles, same runs:

| shortcut | visible ms before | stationary ms before | visible ms after | stationary ms after | poses after |
| --- | --- | --- | --- | --- | --- |
| sunder_ledge | 1085 | 1085 | 559 | 82 | climb, idle |
| root_tunnel | 652 | 652 | 545 | 65 | walk, idle |
| canopy_walk | 784 | 784 | 570 | 90 | climb, idle |
| fallen_duskoak | n/a (setup failed) | — | 615 | 160 | climb, idle |

New coverage in `tests/traversal-motion.test.ts`: the cover reaches opacity 1 between 0.4 s and
0.6 s for 2 s, 3 s, 3.5 s and 6 s obstacles, and a concealed crossing reaches its authored entrance
without overshooting it.

## Shortcut matrix

All nine authored obstacles, `npx tsx tools/traversal-world-check.ts --id <id>` against port 4189.
Evidence: `test-results/traversal-world/<id>-<case>/{report.json,01-entry.png,02-contact.png,
03-travel.png,04-recovery.png,05-landed.png,06-after.png}`.

| shortcut | routed travel used it | crossing | XP once | landing snap | resumed | visible pose | visible ms | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| brookvault_planks | no — walking is faster | yes, direct click | 18 | on mesh | walked away | vault | 532 | crosses no water |
| wall_vault | no — walking is faster | yes, direct click | 18 | on mesh | walked away | vault | **2538, fully visible** | the one uncovered crossing |
| canopy_walk | yes | yes | 43 | on mesh | yes | climb | 570 | entrance stair clips the Rootfall wall |
| fallen_duskoak | no — walking is faster | yes, direct click | 43 | on mesh | walked away | climb | 615 | entity origin 5.77 m under ground |
| root_tunnel | yes | yes | 43 | on mesh | yes | walk | 545 | clean |
| sunder_ledge | yes | yes | 63 | on mesh | yes | climb | 559 | outcrop art is package 09's |
| sunder_ledge reverse | yes | yes | 63 | 1.13 m | yes | climb | 594 | inside `validLanding`'s 2 m, worth tightening |
| scree_slide | yes | yes | 63 | on mesh | **no — route stuck** | climb | — | see issue 1 |
| cairn_leap | no — walking is faster | yes, direct click | 63 | 0.29 m | walked away | vault | 623 | crosses no gap |
| chimney_climb | no — walking is faster | yes, direct click | 63 | 0.00 m | n/a | climb | 620 | see issue 3 and the limit below |

Failure paths: at agility 20 the seeded roll fails the Cairn Leap and the Chimney Climb on every
run, and both were recorded doing the right thing — no XP, health lost, player left at the
entrance. The success rows above use agility `reqLevel + 20`, where the production chance formula
clamps to 1.00, so the crossing is deterministic rather than a rerun lottery.

Scenarios:

| scenario | result |
| --- | --- |
| `root_tunnel --case interrupt` | pass. `corealm_stop` at progress 0.4 leaves the semantic player at `(86.6, 6.50, 138.13)`, no XP, no curtain left in the DOM, and real keyboard input moves the player again. |
| `scree_slide --case oneway` | pass. `planRoute(karrowmoor_terraces -> great_cairn)` returns five walk edges and no `scree_slide` edge; routed travel walks 165 m the long way and awards no XP. |
| `sunder_ledge --reverse` | pass. Reverse crossing awards 63 XP once and lands 1.13 m from the authored point, on the navmesh. |
| `sunder_ledge --case gate` | at agility 9 a click at the entrance is refused with `REQUIREMENTS_NOT_MET: Requires Agility 10`, routed travel does not start the traversal and no XP is awarded. |
| `--case stance` | reports standable ground at both endpoints for `sunder_ledge` and `scree_slide`; flags `fallen_duskoak` (issue 2) and the two dungeon endpoints of `chimney_climb`, where `groundHeight` is the surface 28 m above and the flag is expected. |

Two behaviours worth the root's attention, neither a failure on its own:

 - An out-of-range click on a gated shortcut answers `walking to Broken Ledge` and only refuses on
   arrival, because `GameApi.interact` approaches before it runs the verb. A player learns they are
   too low level after the walk, not before it.
 - `moveTo` reports the route candidate's own ETA for a routed journey and Movement's recomputed
   ETA for a plain path. At the Broken Ledge from the Hillcrest bank node those are 17784 ms and
   12958 ms for the same start and destination, so the two numbers are not comparable in the HUD
   or through the agent API.

"Routed travel used it" is the production planner's own choice: `selectMovementCandidate` compares
real prepared paths and takes the shortcut only when its executable ETA beats the direct walk.
Four shortcuts lose that comparison because Detour's actual walk is far shorter than the authored
road graph. Measured direct path vs graph route cost:

| shortcut | direct nav path | direct ETA | graph route cost |
| --- | --- | --- | --- |
| brookvault_planks | 116.70 m | 22.44 s | 31.52 s |
| fallen_duskoak | 107.88 m | 20.75 s | 20.07 s |
| cairn_leap | 20.10 m | 3.87 s | 7.67 s |
| chimney_climb | 52.03 m | 10.01 s | 6.29 s |

Cairn Leap is the clearest: the authored ledger says 86.5 m round the gap, and the navmesh walk
between the two tarn landings is 20.1 m. The gap it is authored to cross is not a barrier.

## Issues for the orchestrator, with coordinates

1. **Rockslide lands in a pocket the routed walk cannot leave.** `scree_slide` completes, awards
   63 XP and lands exactly on the authored exit `(108, 11.21, -24)`, which is on the navmesh. The
   route's next leg walks to the Lower Quarry stance `(140, 10.21, -16)`, 33 m away. The only
   navmesh path Detour returns for that leg climbs to `(129.8, 24.44, -33.5)`, runs the terrace rim
   through `(148.25, 20.04, -27.2)` and comes back down; the player stops making progress at
   `(148.44, 18.76, -26.84)` and movement gives up with `navigation.failed { reason: "stuck" }`
   after both recoveries. Reproduced twice, and the same detour path is returned by the branch base
   `9d5b6cc` (`test-results/traversal-baseline/scree_slide-stance/report.json`), so the Lower Quarry
   approach predates the navmesh fix. Owner: the Lower Quarry site terrain / world layout.
   Evidence: `test-results/traversal-world/scree_slide-traverse/{report.json,failure.png}`.

2. **The Fallen Ash entity origin is 5.77 m below the ground its drawn end rests on.**
   `fallen_duskoak` is a `roof_log` at scale 1.5 whose measured base offset puts the entity origin
   at `(176, -1.46, 104)` while `meshHeightAt(176, 104)` is `4.311`. The obstacle has no authored
   `interactionPosition`, so that origin is also the traversal entry and contact point. The
   traversal works, but the authored data has no stance. Proposal for the root: give
   `fallen_duskoak` an `interactionPosition` on the bank. Visually the beam is a flat plank sunk
   into the slope rather than a felled trunk
   (`test-results/traversal-world/fallen_duskoak-traverse/01-entry.png`).

3. **The Chimney Climb can be started from the surface, 28.3 m above its chamber.** The
   interaction range check is `distanceXZ` only, in both `world/interactions.ts` and
   `systems/agility.ts`, so standing at `(34, 5.17, -66)` on the Karrowmoor surface accepts
   `climb chimney_climb` whose entrance is at `(34, -23.13, -66)` inside the Gravelmaw. Not
   reachable by ordinary picking, because the dungeon mouth is not drawn from the surface, but the
   tool API accepts it. I did not add a vertical bound: `fallen_duskoak` shows that an authored
   entity origin is legitimately metres away from the stance, so the guard belongs with authored
   stances, not with a blanket height limit. Shared file, so this is a proposal.

4. **Brook Planks crosses no water.** `brookvault_planks` vaults `(-78, -30) -> (-62, -26)`. The
   only water in Fallowmarch is the Redsill fishing basin at `(-40, -60)`; the planks sit on an
   unbroken grass hillside about 45 m away, drawn as a flat dark `floor_wood` board
   (`test-results/traversal-world/brookvault_planks-traverse/05-landed.png`). The Iron Brook the
   obstacle and its blurb are written around is not modelled.

5. **Cairn Leap crosses no gap.** The authored ledger says 86.5 m round the gap; the navmesh walk
   between the two tarn landings is 20.1 m, so routed travel never uses it. Its `rock_medium_3`
   hero at `(246, 43.1, -104)` is a near-black faceted mass that the follow camera sits inside, so
   the player is drawn only as the occlusion silhouette
   (`test-results/traversal-world/cairn_leap-traverse/01-entry.png`).

6. **Camera readability at the Sunder and Scree heroes.** At `(170, 27.47, -74)` and
   `(96, 40.66, -170)` the fixed follow camera at distance 9 ends up inside the `cliff_step`
   drums and the player is only the ghost fill. Note the caveat below: main has since landed
   `588c9e0 Let fixed follow pull in for geometry no cutaway can open` and
   `Merge slice 10: exterior geology and generator provenance`, neither of which is on this
   branch, so both the camera behaviour and that outcrop art need re-checking on current main
   before this is acted on.

7. **Blocky scatter stones.** At the Sunder landing `(176, -114)` the small ground stones are
   axis-aligned cubes and rhomboids with flat faces
   (`test-results/traversal-world/sunder_ledge-traverse/05-landed.png`). Same family visible at the
   Rockslide landing `(108, -24)`.

8. **Canopy Walk entrance clips the Rootfall wall.** The `stairs_exterior` hero at
   `(40, 8.57, 138)` has its right edge and handrail post inside the timber wall behind it, and the
   rail passes through the hanging banner
   (`test-results/traversal-world/canopy_walk-traverse/01-entry.png`).

## Route ledger

`npx tsx tools/traversal-route-ledger.ts` recomputes the authored road-graph saving for every
obstacle. Scree's stale `savesMeters: 168` was already corrected to 136 by integration and still
reconciles.

| obstacle | authored savesMeters | recomputed | walking m | approach m | departure m |
| --- | --- | --- | --- | --- | --- |
| brookvault_planks | 66 | **83** | 223.61 | 100.44 | 40.50 |
| wall_vault | 44 | **51** | 212.77 | 32.00 | 130.00 |
| canopy_walk | 78 | **82** | 120.51 | 26.40 | 11.66 |
| fallen_duskoak | 115 | 115 | 222.79 | 52.00 | 56.14 |
| root_tunnel | 144 | 144 | 176.64 | 24.60 | 8.25 |
| sunder_ledge | 142 | 142 | 187.96 | 20.40 | 25.46 |
| scree_slide | 136 | 136 | 213.00 | 44.41 | 32.98 |
| cairn_leap | 63 | 63 | 86.50 | 8.94 | 14.42 |

`game/src/content/regions.ts` is root-owned, so the three stale values are a proposal, not a
change: `brookvault_planks` 66 → 83, `wall_vault` 44 → 51, `canopy_walk` 78 → 82.

## Settlement routes

`npx tsx runs/corealm-rebuild/checks/settlement-walk-browser.ts --region <id> --url
http://127.0.0.1:4189` walks a real click-to-move route to the bank, the general shop and the
covered crafting station in each town, hovering the drawn mesh, opening the world context menu and
the production panel, with a clearance probe at every sampled position.

| town (region) | bank | shop | craft | result |
| --- | --- | --- | --- | --- |
| Emberfast (kilnhalt) | pass | pass | pass | `semantic-pass-awaiting-screenshot-review`, 39.1 s |
| Hillcrest (karrowmoor) | pass | pass | **fail** | all three orbit attempts on `highcairn_anvil` hovered `npc_quarrier_vess`; the smith stands between every tried camera bearing and the anvil |
| Millfield (fallowmarch) | — | — | — | boot exceeded the script's 20 s allowance, 22.3 s elapsed |
| Rootfall (vellenwood) | — | — | — | boot exceeded the script's 20 s allowance, 21.3 s elapsed |

The two boot timeouts are this branch's own cost. `game/src/app/config.ts` changed, so the shipped
navmesh artifact's fingerprint no longer matches and the runtime generates the mesh at boot. The
script's budget is a hard 60 s with 20 s of it for boot; my own tools allow 50 s and boot fine. Run
`tools/build-navmesh.ts` and the import path — and the 20 s allowance — come back. I did not raise
the shared script's budget to paper over it.

`npx tsx tools/settlement-door-check.ts --region <id> --limit 4` approaches one building per prefab
family from three bearings, walks in through the route planner, records the roof cutaway and camera
and walks out.

| building | prefab | entry from three bearings | detour vs straight line | exit |
| --- | --- | --- | --- | --- |
| coldbrace_gate_south | gatehouse | 0.12–0.14 m short | 1.00–1.13x | clean |
| coldbrace_bank_porch | porch | 0.17–1.42 m short | 1.00–1.39x | clean |
| coldbrace_vault | tower | **NOT_REACHABLE from all three** | — | — |
| coldbrace_hall | hall | **NOT_REACHABLE from all three** | — | — |
| rootfall_house_1 | cottage | **NOT_REACHABLE from all three** | — | — |
| rootfall_house_7 | townhouse | **NOT_REACHABLE from all three** | — | — |
| rootfall_shed | shed | 2.46–2.72 m short | 0.79x, 2.37x, **4.20x** | clean |
| rootfall_forge | forge | no walkable floor inside, not a doorway | — | — |

Nothing routed through props: no sampled stance intersected static geometry and no reachable
approach except `rootfall_shed` from bearing 0 exceeded 2.4x the straight line.

Roof cutaway: `getRoofVisibility().hiddenBuildingIds` was empty at every stance inside a gatehouse
or porch footprint, and the inspected screenshots show that is right rather than broken — the
cutaway is camera driven, and from those bearings the camera already sees the player through the
arch or under the eaves. It engages where it is needed: at the Hillcrest bank counter the porch
roof over the player is cut and the neighbouring roofs stay on
(`test-results/settlement-walk-browser/karrowmoor/bank-arrived.png`).

## Fishing landings

`npx tsx tools/world-landing-check.ts` resolves each landing with the same
`fishingAccessPositions` solver the world builder uses, walks in from 22 m back through the route
planner, then walks to every school in the site and casts.

| fishery | landing snap | routed arrival | stance | schools reached and cast | camera |
| --- | --- | --- | --- | --- | --- |
| redsill_bank | 0.00 m | 0.00 m | dry, on ground | 4 / 4 | clear, no silhouette |
| blackwater_landing | 0.00 m | 0.00 m | dry, on ground | 5 / 5 | clear, no silhouette |
| cairn_tarn_ledge | 0.00 m | 0.00 m | dry, on ground | 2 / 2 | clear, no silhouette |
| far_tarn_cove | 0.00 m | 0.01 m | dry, on ground | 2 / 2 | clear, no silhouette |
| ashfin_warm_bank | 0.00 m | 0.00 m | dry, on ground | 4 / 4 | clear, no silhouette |

All 17 schools accept a cast from the routed stance and start a real gathering activity, and the
routed arrival is within 0.34 m of the authored stance every time. The 9.7–18.7 m cast distance
across the water is by design: fish keep their underwater positions and the dispatcher measures the
authored dry stance.

One readability note rather than a failure: at Blackwater and Far Tarn the player finishes the
routed walk facing away from the water and casts with the pool behind them
(`test-results/world-landings/{blackwater_landing,far_tarn_cove}-cast.png`). Facing comes from the
movement look-ahead at the last path corner, not from the interaction target.

## Coast, lake and relief views

`npx tsx tools/world-view-check.ts` stands the player at each point with the production follow
camera. All four coastal edges, all five solved water bodies and five of six relief points are
reachable with an unoccluded camera.

| view | stance | note |
| --- | --- | --- |
| coast-west | (-478, 0.71, 130) | reachable, no scatter of any kind in frame |
| coast-east | (386, 1.21, 130) | reachable, no scatter of any kind in frame |
| coast-south | (0, 2.20, -300) | reachable |
| coast-north | (0, 1.84, 548) | reachable, one coastal creature standing on bare ground |
| lake-redsill_spots | (-17.75, -1.72, -49.58) | reachable |
| lake-blackwater_spots | (108.21, 7.44, 103.16) | reachable; a rock slab cuts into the grass dome with no bedding under it |
| lake-cairn_tarn_spots | (223.28, 29.13, -72.56) | reachable |
| lake-far_tarn_spots | (304.31, 42.01, -101.84) | reachable |
| lake-ashfin_spring_spots | (231.90, 32.81, 237.31) | reachable |
| karrowmoor-terraces | (140, 10.44, -16) | **the camera sits inside the quarry cut face; the player is only the occlusion ghost** |
| rockslide-landing | (108, 11.22, -24) | reachable, camera clear |
| gorge-head | (104, 5.80, 192) | reachable, camera clear |
| highcairn-approach | (176, 43.60, -114) | reachable, camera clear |
| coldbrace-mill-road | (-160, 1.04, -55.1) | reachable, camera clear |
| vellenwood-valley | (128, 84) | off the navmesh, correctly: this is the middle of the Blackwater pool, not a stance |

Composition issues from these ordinary standing positions:

 - **The coastal collar is undressed.** At `(-478, 130)`, `(386, 130)` and `(0, 548)` the ground is
   an unbroken plain with no grass, rock, tree or dressing of any kind, and it is walkable.
   `docs/world-authoring.md` says normal biome recipes sample all dry visual land through
   `getScatterBounds(Infinity)`, so this is either an unfinished part of the coastal work or a
   scatter-residency delay. The re-run records `getScatterResidency()` at each point to separate
   the two.
 - **A bare 59-degree face at the eastern coast.** `tools/verify-slope-traversal.ts` found and
   walked a real authored 58.99-degree facet, `(464, 13.68, -75)` down to `(466, 10.35, -75)` and
   back up, both legs completing exactly. The face itself is a featureless brown slope running into
   the sea (`test-results/movement-slope/steep-descent.png`).
 - **Blocky ground stones.** At the Sunder landing `(176, -114)`, the Rockslide landing
   `(108, -24)` and the Far Tarn bank `(272, -118)` the small stones are axis-aligned cubes,
   rhomboids and flat-topped hexagonal prisms.
 - **Bare lake banks.** The Far Tarn and Cairn Tarn shorelines are a broad chocolate-brown band with
   a hard edge against the grass and a pale rim where the water plane meets the bank.

## Tooling

- `tools/traversal-world-check.ts` — one obstacle and direction per invocation,
  `--case traverse|stance|interrupt|gate|oneway`, `--agility <n>`, `--reverse`. Takes its stand
  point from the route plan's first leg rather than the region rectangle's authored coordinate, and
  falls back to a direct click when the planner legitimately prefers walking.
- `tools/world-landing-check.ts` — routed arrival, stance, cast and camera readability at every
  authored fishery landing, using the same `fishingAccessPositions` solver the world builder uses.
- `tools/world-view-check.ts` — production follow-camera captures of the four coastal edges, every
  solved water body and six named relief views, with terrain samples and scatter residency.
- `tools/settlement-door-check.ts` — doorway entry and exit from three bearings per prefab family,
  with the roof cutaway, camera and clearance at each inside stance.
- `tools/verify-slope-traversal.ts` was already in the tree and unreferenced. It finds a real
  authored 30–63 degree facet and walks it both ways; it is the direct check on the shared slope
  limit and is worth keeping.
- Preserved review scripts under `runs/corealm-rebuild/checks/` that hardcoded `127.0.0.1:4175` now
  read `COREALM_URL`, so worktrees can share the machine on separate ports.

## Deletions

- `runs/corealm-rebuild/checks/diagnose-rootfall-movement.ts` — the CPU probe written to hunt the
  Rootfall stair grid phase. The cause is fixed in `NAV_CONFIG` and the behaviour is covered by
  `tests/structure-movement-grounding.test.ts`; the script hardcodes the pre-fix 8.29 origin and
  the stretch/widen experiment that produced nothing.
- `runs/corealm-rebuild/checks/inspect-agility-landform.ts` — sampled terrain around the Sunder and
  Scree heroes by reading a prior report out of ignored `test-results/`, so it cannot run in a fresh
  worktree at all. `--case stance` reports the same thing from the live world.

Both are unreferenced by any doc, test or script. `inspect-rootfall.ts`, `inspect-rootfall-crest.ts`
and `inspect-rootfall-fit.ts` are the same class of leftover but belong to package 09; I left them
and flag them here.

## Limits

- No release gate, no navmesh regeneration and no map regeneration was run here. Navmesh
  regeneration IS required before release; map regeneration is not, because no authored placement
  moved.
- The branch is behind: `main` gained 20 commits during this slice, including
  `588c9e0 Let fixed follow pull in for geometry no cutaway can open` and
  `Merge slice 10: exterior geology and generator provenance`. Every camera-readability and
  outcrop-art observation here predates both and needs re-checking on current main. I rebased once
  at the start, as instructed, and did not rebase again.
- Screenshots record what the camera drew. They are not art acceptance.
- The Chimney Climb evidence is bounded. It was reached through the XZ-only range hole rather than
  through a real portal entry, so its landing renders inside an unloaded dungeon interior. Its
  crossing, XP and refusal behaviour are sound; its rendering evidence is not.
- `game/src/systems/movement.ts` and `game/src/input/mouse.ts` were treated as read-only. Nothing in
  this slice needed a change there.
