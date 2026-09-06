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

### AFTER-FIX-SUMMARY

## Mine × check matrix

### AFTER-MATRIX

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

The mine cut faces were **not** given `userData.cameraHardBlocker`. That tag makes the fixed follow camera
pull in, and it is currently carried only by the dungeon shell. A mine cut face is a wall the player stands
in front of rather than inside; the camera never ended up behind one in these runs, and adding the tag
would pull the camera in every time the player mines with their back to the cliff, which is the normal case.
If a later camera round shows the cliff clipping the follow camera, that is the moment to add it.

## Limits

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
- `hollowcut_corven_1` has no accepted click evidence, because it cannot be hovered past the postern.
