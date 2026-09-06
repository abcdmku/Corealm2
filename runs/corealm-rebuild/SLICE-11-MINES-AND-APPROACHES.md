# Slice 11: mines and cave approaches

All five authored mines — Bracken Workings, Hollowcut Workings, Lower Quarry Bench, Upper Seam Shelf and
Clinker Cut — were driven end to end in the real world on hardware D3D11, and the exposed rear shoulder on
their cut faces was measured, fixed and re-measured.

The whole mine matrix is one command:

```
PORT=4190 node runs/corealm-rebuild/checks/stable-server.mjs   # in a second shell
PORT=4190 npx tsx tools/mine-finish-check.ts --out test-results/slice11/after
```

`tools/mine-rear-wall-audit.ts` is the CPU half and needs no browser:

```
npx tsx tools/mine-rear-wall-audit.ts
```

## Navmesh regeneration is required

`game/src/render/mineCutFace.ts` is one of the `solidCarves` sources in `tools/build-navmesh.ts`, and the
cut face's `SolidVolume` boxes are part of the geometry handed to Recast. The rear-shoulder fix therefore
changes both the source fingerprint and the Recast geometry digest, so the committed
`game/public/generated/corealm-navmesh.bin` no longer matches and the game falls back to a runtime build.
**`npx tsx tools/build-navmesh.ts` has to be re-run before this branch merges.** This slice was told not to
regenerate, so it did not.

Every browser measurement below was taken on a runtime-built navmesh derived from the changed geometry, not
on the committed artifact. Navigation was `status: "ready"` in every run. The pre-change baseline runs used
the committed artifact at 3539 polygons, which is main's regenerated mesh at `walkableClimb: 8`.

## The rear shoulder was a flat roof over a bank that had not risen

`buildMineCutFace` draws each cross-section as a cliff face up to a crest, then roof rows back to a rear
foot buried under the terrain. The roof burial distance came from a search along the crest-to-rear ray for
the first point where the receiving bank reaches `crest.y - 0.30`.

On the real heightfield that bank does not arrive quickly. Measured with `tools/mine-rear-wall-audit.ts`,
the terrain 1.5 m behind the crest lip sits 0.6-4.2 m *below* the crest at every station, and only reaches
it around 2.5-4.5 m back. The search stretched to meet it, so the roof stayed near-horizontal across that
whole span: a smooth grey plane standing 2-4 m above the grass, ending in a straight hard chord across the
hillside, with the per-station recessed fractures showing as a row of triangular fins.

Exposed shell area above the actual rendered terrain triangles, before:

| mine | tris | front m² | rear m² | side m² | top m² | bottom m² | max rear rise | max side rise |
|---|---|---|---|---|---|---|---|---|
| bracken_workings | 27800 | 69.94 | 9.71 | 6.10 | 78.58 | 12.97 | 3.035 | 2.733 |
| hollowcut_workings | 17400 | 50.37 | 10.96 | 2.82 | 39.00 | 7.97 | 2.948 | 3.362 |
| lower_quarry_bench | 18800 | 54.18 | 14.79 | 4.97 | 48.31 | 12.07 | 2.651 | 3.077 |
| upper_seam_shelf | 13800 | 34.28 | 9.40 | 4.58 | 26.69 | 7.22 | 2.816 | 2.423 |
| clinker_cut | 26600 | 106.60 | 30.72 | 10.85 | 82.03 | 18.24 | 4.082 | 3.932 |

`front` is the intended cliff. `top`, `rear` and `side` are the defect.

Inspected before-screenshots: `test-results/slice11/before-check/*-rear-left.png`, `*-rear-right.png`,
`*-side-high.png`. Bracken and Clinker read as a grey tarpaulin laid over the ridge; Hollowcut showed the
pale rear cut-wall strip already recorded in `FINISH-INTEGRATION.md`; Upper Seam's slabs floated with
daylight under their western end.

### The roof now falls away from the crest

The roof rows leave the crest on a bounded grade instead of waiting for the bank, crowd toward the crest
where the exposed slope actually is, and carry a lateral weathering offset so the rock-to-grass line is
broken rather than a straight chord. The `shoulderDepth` search is unchanged, and the new bound only ever
lowers a row.

One correctness repair was needed on top of that. A monotonic "no uphill shelf" clamp is right while the
terrain is flat and wrong where the bank climbs: pinning a deep row to a shallower row's height drove the
roof through the buried underside and turned the shell inside out. `tests/mine-cut-face.test.ts` caught it
as a signed volume of -98.2 where it requires a positive one. The clamp now also respects the local
terrain, so a rising bank carries the buried roof up with it.

| mine | top m² before → after | plan behind crest m² before → after | front m² before → after |
|---|---|---|---|
| bracken_workings | 78.58 → 20.29 (−74%) | 50.87 → 35.42 (−30%) | 69.94 → 69.64 |
| hollowcut_workings | 39.00 → 10.59 (−73%) | 33.69 → 26.56 (−21%) | 50.37 → 50.37 |
| lower_quarry_bench | 48.31 → 18.48 (−62%) | 38.01 → 30.10 (−21%) | 54.18 → 53.87 |
| upper_seam_shelf | 26.69 → 10.22 (−62%) | 24.48 → 19.90 (−19%) | 34.28 → 34.28 |
| clinker_cut | 82.03 → 23.63 (−71%) | 62.47 → 47.93 (−23%) | 106.60 → 105.12 |

The visible cliff is intact at every mine, and triangle counts are unchanged.

Read the `rear` column with care. It rises sharply (Bracken 9.71 → 64.72) because the audit bins by facing
and the flat roof that used to be `top` is now a 60-degree back slope. Surface area alone cannot separate a
flat roof from a steep slope of the same reach, which is why the audit now also reports the horizontal
ground the exposed shell covers behind the crest lip. That is the number a rear or overhead camera actually
reads, and it is down 19-30 percent.

The pictures are the point. Compare `test-results/slice11/before-check/*-rear-left.png`,
`*-rear-right.png` and `*-side-high.png` with `test-results/slice11/after-views/` and
`test-results/slice11/after/`. Bracken's side-high view goes from a broad grey ramp spilling across the
hillside behind a hard straight boundary to a narrow crest band with grass meeting the stone. Clinker's
rear-left goes from a flat grey plateau over the ridge to a slim outcrop breaking out of the slope.
Bracken's approach loses the pale grey wedge that used to ramp down over the right half of the cut.

The roof loop itself was authored by the Codex CLI (gpt-6-astra, medium) from a bounded spec. It could not
run its own verification — `npx` is not on its PATH — so every number and every screenshot here is mine.
The inside-out repair and the plan-footprint metric are also mine.

### What the fix did not reach

- **Lower Quarry's upper bank.** The cut face reads correctly, but the near-vertical dark earth wall the
  site terrain excavates above it still has a hard top edge and a shadow gap at the cut's crest. That is
  `siteTerrain`'s `backRise`, not the cut face.
- **Upper Seam has no working floor.** The site sits across a steep flank, so the ore rocks stand on about
  a 25-degree slope and the cut face is pressed against the hillside rather than standing behind a bench.
  It plays correctly — every rock passes approach, extraction and return — but it does not read as a mine.
  Both need `terrain.floorRadius` / `backRise` changes, which is a terrain edit and a navmesh regeneration.
- **Bracken's crest is still serrated from directly behind.** The per-station recessed fractures show as a
  row of low fins where the crest stands above the bank. Flattening them would mean capping the crest at
  the terrain a couple of metres behind it, which costs about 0.9 m of visible cliff at Bracken and is a
  worse trade for the aisle view.

## Mine × check matrix

One command, one Chromium session, hardware `ANGLE (NVIDIA GeForce RTX 5080, Direct3D11)`, clock at
`timeScale 1` and unpaused throughout. Receipt: `test-results/slice11/after/report.json`. Zero runtime
errors, zero console errors, zero failed requests.

| check | Bracken | Hollowcut | Lower Quarry | Upper Seam | Clinker |
|---|---|---|---|---|---|
| stances on navmesh (count, worst gap) | 8, 0.121 m | 5, 0.001 m | 5, 0.080 m | 3, 0.015 m | 8, 0.124 m |
| body clear of statics and trunks at every stance | pass, 0 shift | pass, 0 shift | pass, 0 shift | pass, 0 shift | pass, 0 shift |
| approach route node → ramp end | north_milestone, 87.3 m | rootfall_hamlet, 21.8 m | moor_road_bend, 16.6 m | ridge_pines, 77.7 m | kilnhalt_south_track, 138.3 m |
| no climb-looking route leg (max grade, bound 0.55) | 0.055 | 0.000 | 0.090 | 0.122 | 0.008 |
| haul-ramp grade on real terrain (bound 0.55) | 0.442 | **0.616 FAIL** | 0.400 | 0.376 | 0.234 |
| every rock clicked at full, with ore + XP receipt | 8/8 | 5/5 | 5/5 | 3/3 | 8/8 |
| every rock clicked again at partial, with receipt | 8/8 | 5/5 | 5/5 | 3/3 | 8/8 |
| worked from inside the 0.45 m stance (worst) | 0.326 m | 0.132 m | 0.284 m | 0.321 m | 0.330 m |
| depleted rock stays drawn, clicks, yields nothing | pass | pass | pass | pass | pass |
| natural respawn back to available | 21 s / 15 s | 32 s / 25 s | 43 s / 36 s | 43 s / 36 s | 65 s / 58 s |
| inventory-full stop | `inventory.full` | `inventory.full` | `inventory.full` | `inventory.full` | `inventory.full` |
| haul return by ground click (arrival gap) | 0.46 m | 0.12 m | 0.03 m | 0.68 m | 0.55 m |
| every rock readable from the approach | 8/8 | **4/5 FAIL** | 5/5 | 3/3 | **7/8 FAIL** |
| cut face composition views | 5 | 5 | 5 | 5 | 5 |

Reading the rows:

- *stances on navmesh* projects each ore's production `interactionPosition` with `getNavPoint` and measures
  the horizontal displacement; *body clear* is `probeWorldClearance` at `PLAYER_RADIUS`.
- *approach* is the nearest authored route node from which production navigation actually reaches the haul
  endpoint. The check walks down the candidate list and records the ones it rejected, so an unreachable
  mine would show as a failure rather than a silently different start.
- *every rock clicked* is a real canvas hover-and-click on the drawn ore, then production movement all the
  way in. XP is read from the Mining skill total because gathering emits no XP event of its own; the gains
  were 10 at Bracken, 24 at Hollowcut, 35 at Lower Quarry and Upper Seam, 52 at Clinker, with the two
  higher-tier flux rocks paying 120 and 104.
- *readable from the approach* is the strict one. It fails when the rock needs the player to walk onto the
  apron, or a detached camera, before it can be hovered at all. `hollowcut_corven_1` and
  `clinker_kilnstone_1` fail it; both still got their real click and receipts from a framed camera.

`clinker_kilnstone_1` is the far west flux rock, 11.5 m off the aisle centre along the seam. Nothing
occludes it — every sample simply projected off screen from the follow camera at the emberite stances. It
is an authored-layout readability gap rather than an obstruction, and much milder than Hollowcut's.


## Defects that this slice measured but did not fix

Both need a terrain or settlement change, which means a navmesh regeneration and a route-ledger re-check
that this slice was not allowed to run.

**Hollowcut's haul-ramp end lands on the Rootfall postern gatehouse.** `rootfall_postern` is a `gatehouse`
prefab at `[80, 138]`, 8 m × 4 m, `rotationY` π/2. Hollowcut's authored ramp end, from
`worldSiteHaulRamp`, is `[81.9, 139.0]` — 2.15 m away, inside the building footprint, and well inside the
mine's own `extent: [16, 20]`. Consequences measured in the browser:

- The approach composition view from the authored approach bearing is entirely filled by the gatehouse
  roof (`test-results/slice11/before-check/hollowcut_workings-approach.png`).
- No ore rock is hoverable from the follow camera on the approach, or from a camera turned straight at it.
  Four of the five become hoverable only after the player walks onto the site apron.
- `hollowcut_corven_1`, the westernmost rock, stays occluded even from the apron. Recorded blockers are
  `rootfall_postern#gable1` and `rootfall_postern#deck_0_3`.

This is the same root cause as the "return ground click selects the postern building instead of ground"
entry in `FINISH-INTEGRATION.md`. The fix is to separate the two approaches: either move `rootfall_postern`
about 6 m west, or turn Hollowcut's `terrain.approachAngle` from `0` toward `-1.0`, which swings the ramp
end from `[81.9, 139.0]` to roughly `[92.5, 131.6]` and puts 14.2 m between it and the gatehouse. Both
change authored terrain or settlement data and need `tools/build-navmesh.ts` re-run afterwards.

**Hollowcut's haul lane exceeds its own grade intent.** Measured on real world terrain along the authored
lane at ±1.2 m across, the steepest half-metre step is 0.616. `tests/mine-haul-ramp.test.ts` holds the lane
under 0.55 on a sloping incoming grade and 0.40 on flat ground. The lane centre profile climbs 3.95 m to
8.29 m over about 11 m, which is fine; the edges of the lane are what break the bound, because the site sits
across the fall line of the raised Rootfall support. The other four mines pass: Bracken 0.442,
Lower Quarry 0.400, Upper Seam 0.376, Clinker 0.234.

## Entrance placement, cave and shortcut separation

Every mining stance in `WorldPorts.accessPositions` lands on the navmesh with the promoted rock bounds. Over
all 29 authored ore slots the largest gap between the authored stance and its production navmesh projection
is 0.124 m, and `probeWorldClearance` at `PLAYER_RADIUS` reports a static shift of exactly 0 at every one,
with no resident trunk overlaps.

Distance from each mine's working aisle centre to the nearest cave mouth or region gate, and to the nearest
Agility shortcut endpoint:

| mine | nearest cave/gate | m | nearest shortcut endpoint | m |
|---|---|---|---|---|
| bracken_workings | fallowmarch_north_gate | 139.8 | wall_vault exit | 131.7 |
| hollowcut_workings | vellenwood_marchgate | 110.4 | root_tunnel entry | 12.6 |
| lower_quarry_bench | gravelmaw_entrance | 92.4 | scree_slide exit | 31.0 |
| upper_seam_shelf | karrowmoor_north_gate | 150.4 | sunder_ledge exit | 27.4 |
| clinker_cut | emberfast_west_postern | 228.0 | canopy_walk exit | 318.0 |

The authored Gravelmaw, which now renders the scanned cave facing, is 92.4 m from the Lower Quarry aisle and
outside the quarry's `extent: [14, 22]`. Lower Quarry's own approach comes in from Moor Road Bend, 16.6 m
away on a separate bearing, and the quarry read as its own place in the approach and aisle captures. The
`scree_slide` exit lands 31.0 m west of the aisle on the open apron, clear of the working stances.

Hollowcut's 12.6 m to the `root_tunnel` entry is the tightest separation in the world and is the same
crowded corner as the postern defect above. It clears the aisle, but only just.

The mine cut faces were **not** given `userData.cameraHardBlocker`, and they do not need it. The camera
already treats the cliff as an obstruction: `buildMineCutFace` returns `SolidVolume` boxes that
`app/boot.ts` feeds into `cameraQueries.addStaticBox` along with every other world solid. What the hard
flag adds, per `systems/staticCameraQueries.ts`, is an exemption from the roof cutaway — "no cutaway opens
this, so fixed follow has to pull in rather than sit outside". That matters for the dungeon shell, which
the cutaway would otherwise open. Nothing cuts away a mine cliff, so tagging it would only change how the
camera recovers when the player mines with their back to the face, which is the normal case. If a later
camera round shows the follow camera sitting inside a cut face, that is the moment to revisit it.

## Limits

- The branch was rebased onto main twice: first for the `walkableClimb` 10 → 8 change and the regenerated
  navmesh, which every measurement here already reflects, and again onto slice 05 afterwards. That second
  rebase brought only creature content — `assetLicenses.ts`, `creatureMotionTiming.ts`, `regionalPacks.ts`
  and creature GLBs — and touched nothing in the navmesh fingerprint groups, terrain, world sites or the
  cut face. The audit reproduces byte for byte on top of it and all 123 focused tests pass, so the browser
  evidence, captured just before it, still describes this tree.
- No release gate, no navmesh regeneration, no performance claim.
- The depleted state is reached with `depleteNode` rather than 8-15 real yields, and the pack is filled with
  `giveItem` for the inventory-full case. Both are recorded per mine in the report's `shortcuts` list. Every
  extraction, every approach and every return in the matrix is real production movement from a real canvas
  click.
- Mining eligibility is set up per mine with `clearInventory`, a tier-appropriate pickaxe and a Mining level
  above the seam requirement and below the cap. No clock, yield, respawn or drop value is edited.
- Each mine's slow states — depleted, natural respawn, inventory-full — run on its first rock only, so the
  matrix fits one browser session. Every rock at every mine gets its full and partial states.
- The composition views are a detached inspection camera. They establish cut-face appearance, not gameplay
  camera clearance.
- `hollowcut_corven_1` and `clinker_kilnstone_1` were clicked from a framed camera the follow camera never
  reached. Their extraction is real; their readability is not accepted.
- The audit's `rear` column is not comparable across the fix, because the same geometry changes facing bin.
  Compare `top` and the new plan footprint instead.
- Deleted as superseded and unreferenced: `art/rebuild/candidates/2026-09-05/ground-ore/` (3.8 MB, twelve
  models from generator `a6f1cb96`, not the served bytes).
