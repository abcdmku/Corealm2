# Slice 05: remaining creature replacements

Spider and fantasy bee were delivered earlier. This slice works through the creatures that were still
unresolved, one at a time, and only promotes an asset after the production feature lab has run its
whole natural lifecycle on a hardware renderer with the candidate bytes served in place.

Ground rules that hold for every row below:

- The lab runs against the real game on port 4181 with production code paths. No health, pose, clock
  or AI-state overrides. Death is reached by an ordinary sword kill and respawn is waited out.
- Contact and paw measurements are taken on **skinned vertices**, not bone tips, and in metres. The
  Fox source joints already carry the 0.01 scene scale, so raw local vertex units mean nothing here.
- KEEP or "improved direction" is not acceptance. Only the rows marked accepted moved into
  `game/public/assets`.

## Decision table

| Creature | State | Reason | Evidence | Source and licence |
| --- | --- | --- | --- | --- |
| Ashscale Monitor (`creature_ashscale_monitor`) | **Accepted, promoted** | Full natural lifecycle passed on hardware with no console errors; front/side/rear/gameplay silhouettes read as a monitor; the settled death pose is grounded and belly-down; loot, XP and respawn all natural. | `test-results/s05-monitor-lifecycle/run5/report.json`, `test-results/s05-monitor-views/` | Original Corealm authored geometry, rig and clips (`tools/creature-expansion/reptiles/monitor.mjs`), pack `corealm-creature-expansion`, `LicenseRef-Corealm-Original` |
| Redbrush Fox (`creature_redbrush_fox`) | **Accepted, promoted** | Paws reshaped into padded four-lobed canid paws (`paws-v3`), resting clip renamed to `Idle`, full natural lifecycle passed on hardware with no console errors. | `test-results/s05-fox-lifecycle/run3/report.json`, `test-results/s05-fox-v3-views/`, `test-results/s05-fox-v3-close/`, `art/rebuild/candidates/finish-quadrupeds/source-fox-adaptation/paws-v3-review.json` | Khronos glTF-Sample-Assets Fox — PixelMannen (model, CC0-1.0), tomkranis (rig/animation, CC-BY-4.0), @AsoboStudio and @scurest (glTF conversion, CC-BY-4.0); adapted asset distributed CC-BY-4.0 |
| Duskoak Lynx | **Held** | Fresh hardware view: forelegs collapse forward at the wrist with the chest almost on the ground, and the silhouette reads closer to a hyena than a lynx. The candidate also has no Attack, Hit or Death clip at all, on a 196-joint, 50 372-triangle, 20 MB rig. | `test-results/s05-lynx-views/`, `source-feline/PAUSED-ACTOR2-CHECKPOINT.md` | JonasDichelle Cat, CC-BY-3.0 (base only) |
| Rootdelve Badger | **Held** | Fresh hardware view: the head is buried in the ground and the body is slumped flat with the legs splayed — it reads as a dying animal in its idle. Only 5 930 triangles. | `test-results/s05-mammal-views/` | CDmir/TinyWorlds rat, CC0-1.0 (base only) |
| Quillback Porcupine | **Held** | Closest of the three rat/cat-derived mammals: the quill mantle reads well. Still blocked by a crouched idle with no weight-bearing feet, and by a naked pink rat tail that no porcupine has. Slides 2.14/3.35 m/s at real toe contacts. | `test-results/s05-mammal-views/` | CDmir/TinyWorlds rat, CC0-1.0 (base only) |
| Cairn Bighorn (`creature_cairn_bighorn`) | **Accepted, promoted** | Re-exported from the corrected source. Shipped Death sank 0.453 m through the floor for 29% of its samples; the new one never leaves the ground. Full lifecycle passed. | `test-results/s05-hoofed-lifecycle/cairn_bighorn/report.json`, `test-results/s05-hoofed-views/` | Original Corealm authored anatomy, rig and clips (`tools/creature-expansion/hoofed/`), `LicenseRef-Corealm-Original`. The separate p0ss Sheep2 CC-BY-SA-3.0 source-derived candidate remains a static anatomy experiment and was **not** promoted. |
| Bracken Tapir (`creature_bracken_tapir`) | **Accepted, promoted** | Re-exported from the corrected source. Shipped Death sank 0.451 m through the floor for 31% of its samples; the new one never leaves the ground. Full lifecycle passed. | `test-results/s05-hoofed-lifecycle/bracken_tapir/report.json`, `test-results/s05-hoofed-views/`, `test-results/s05-hoofed-shipped/` | Original Corealm authored anatomy, rig and clips, `LicenseRef-Corealm-Original`. The separate CC0-horse-derived candidate remains a static anatomy experiment and was **not** promoted. |
| Marchwild Horse (`creature_marchwild_horse`) | **Accepted, promoted** | Re-exported from the corrected source. Shipped Death sank 0.625 m through the floor for 13% of its samples; the new one never leaves the ground. Full lifecycle passed. | `test-results/s05-hoofed-lifecycle/marchwild_horse/report.json` | Original Corealm authored anatomy, rig and clips, `LicenseRef-Corealm-Original` |
| Marsh Moose (`creature_marsh_moose`) | **Accepted, promoted** | Re-exported from the corrected source. Shipped Death sank 0.880 m through the floor for 26% of its samples; the new one never leaves the ground. Full lifecycle passed. | `test-results/s05-hoofed-lifecycle/marsh_moose/report.json` | Original Corealm authored anatomy, rig and clips, `LicenseRef-Corealm-Original`. The CC0-horse-derived Moose remains unresolved (`Bone.005` mapping) and was **not** promoted. |

No animal-head humanoid, demonic or chunky/rubbery cartoon candidate was considered, produced or
retained at any point in this round.

## Ashscale Monitor

The static direction had already been approved; what was missing was the moving lifecycle and the
death pose. The revision8 bytes (`81aa4269996482a5ca3f752b1a50ca8830f0449cded062d817c588d73bddf00e`,
3 035 692 bytes, 32 230 triangles) were re-verified against the current generator sources before
anything ran — `tools/build-creature-expansion.ts`, `creature-expansion/packs.ts`, `reptiles.mjs`,
`reptiles/monitor.mjs`, `reptiles/preview.mjs`, `reptiles/tortoise.mjs` and `package-lock.json` all
still hash to the values pinned in `monitor-promotion.json`. The GLB shipping in the manifest was the
older `7177dba2…` build, so the accepted revision had never actually reached production.

Hardware gallery views (`test-results/s05-monitor-views/`): the side view shows a continuous shoulder
and hip transition with no round caps, tapering forearms, a long raised neck, a shallow wedge skull
and a muscular tapered tail. Rear and gameplay views show splayed limbs with readable clawed digits.
The front view is uninformative rather than wrong — a low-slung lizard with its head down presents
almost nothing head-on — so it is recorded as such rather than counted as a pass.

Lifecycle (`test-results/s05-monitor-lifecycle/run5`, passed): idle → aggro → pursuit → moving turn →
attack → hit → death → settled corpse → loot pickup → respawn, 11.26 m of natural travel, 0.98 rad of
turning **while moving**, advancing Run confirmed, hit delivered as a `native-masked` four-bone
overlay over the continuing gait, `monitor_sinew` dropped and transferred by an ordinary pointer
pickup, 348 melee XP and 53 marks, zero page errors and zero runtime errors.

### Two harness fixes this needed

The four earlier attempts all failed on harness timing, not on the asset. Their dumps were deleted
during cleanup; the two causes and their measurements are recorded here.

1. **Settled-corpse race.** The production corpse lingers for `deathClipSeconds + 350 ms` and then
   dissolves over 900 ms, so the settled view has only a few hundred milliseconds. A full 1440×1000
   PNG encode took 411–578 ms and the corpse was already 32% dissolved by the time the shutter
   closed. The corpse frames are now encoded from a centred crop, which is where `inspectPose` has
   already framed the actor; the run5 corpse capture recorded `fade` 0 both before and after.
2. **Guessed settle margin.** `tools/creature-expansion/mammals/death-settle.mjs` was added to
   measure when a Death clip actually stops moving: the largest distance any skinned vertex still has
   to travel to reach its final-frame position. The Monitor's Death settles to within 5 mm at
   t = 1.445 s of 1.700 s, so `--settle-margin 0.255` is a measurement rather than a guess.

`--max-corpse-fade` (default 0.35) now bounds how far the dissolve may advance during a capture, and
the exact bracketing fade values are recorded either way. It was not needed here.

## Redbrush Fox

The base is the complete Khronos glTF sample Fox, which honours the preference for a licensed
whole-body source over another procedural rebuild. Side, rear and gameplay-distance views already
read clearly as a red fox: narrow chest, pointed muzzle, tall ears, dark stockings, a white-tipped
brush. The one outstanding defect was the paws, and the previous round's `paws-v2` did not fix it.

### What was actually wrong

Measured with `tools/creature-expansion/mammals/paw-contact-audit.mjs` (new). A foot region is every
vertex with at least half its skin weight on the terminal joint; the contact patch is the region
vertices within 3 mm of that foot's lowest **skinned** vertex, in the bind pose, in metres.

| Foot | Contact patch before | Width in 8 rear→front slices |
| --- | --- | --- |
| `b_RightHand_08` / `b_LeftHand_011` | 4.73 × 7.59 cm | 4.73 / 4.46 / 2.42 / 1.09 / 0 / 0.58 / 0 / 0.34 cm |
| `b_LeftFoot02_018` / `b_RightFoot02_022` | 4.93 × 6.52 cm | 1.26 / 2.61 / 3.83 / 4.93 / 4.66 / 4.26 / 3.80 / 1.95 cm |

The front 60% of the forepaw footprint was a near-zero-width spike, which is exactly what the close
hardware views of the v2 candidate showed: a pointed flat shoe rather than a padded four-toed paw.
Those v2 frames were deleted during cleanup once the measurement above had been recorded and the
replacement `test-results/s05-fox-v3-close/` frames captured.

Two things about the previous round's checkpoint would mislead anyone who trusted it:

- `paws-v2-review.json` reports its own `visualAcceptance: false`,
  `fourDistinctRoundedToeLobesAccepted: false` and `soleOutlineTargetAccepted: false`. It was never
  claimed as a fix.
- `fox-paws-v2-comparison/catalogue.json` stages `482ba174aca63cb7c5eda5c0f56b5a5feff9a45d4a09abb37d983bd6859c6466`,
  but `Fox.paws-v2.glb` on disk hashes to
  `2859acf0777b4882f78c99e6b9aac95d5da7f4fe845cc8ab3d48749fee1b3e48`. The staged bytes were a stale
  earlier iteration. It made no difference to the measurement: those two files and the underlying
  `Fox.adaptive-actor.glb` all have an **identical** contact patch, because `paws-v2` froze the
  contact vertex set exactly and could therefore only add volume above the sole. The pointed
  footprint survived every iteration.

### The fix

`paws-v3.mjs` releases the horizontal half of that constraint. Contact vertices keep their bind-pose
world Y — so ground contact height and every clip floor are preserved — but may move in X and Z to
form a rounded footprint with three shallow clefts and four toe lobes. Independently re-measured on
the promoted bytes:

| Foot | Contact patch after | Width in 8 rear→front slices |
| --- | --- | --- |
| Fore | 5.65 × 5.07 cm, aspect 1.116 | 5.47 / 5.54 / 5.50 / 5.61 / 5.60 / 4.76 / 4.72 / 3.82 cm |
| Hind | 5.33 × 5.93 cm, aspect 0.900 | 2.52 / 4.18 / 5.17 / 5.23 / 5.33 / 5.09 / 4.61 / 3.83 cm |

No slice collapses to zero, the widest slice is mid-foot on all four feet, and the lowest skinned
world Y per foot is unchanged to the last digit (-0.00060 m fore, -0.00122 m hind), which is what
keeps the existing contact-corrected Walk and Run valid. `paws-v3-review.json` records per-accessor
and per-section SHA-256 identity (only POSITION and NORMAL changed), 1 494 moved vertices, 21.5 mm
maximum displacement, zero flipped or degenerate triangles, ≤0.478° normal change on any unmoved
vertex, bilateral symmetry within 0.7 µm, and every clip floor within 0.5 mm of its previous value
(worst: Death, -0.48 mm).

### Clip naming

The Khronos source calls its resting clip `Survey`. The production renderer's own-clip idle row
matches `/^idle/i`, `/^flying/i` and `/_?closed$/i`, so `Survey` only played because the idle row
falls through to "any remaining clip in manifest order" and `Survey` happened to be first. That is
an ordering accident, not a match. `rename-idle.mjs` renames it to `Idle` with a JSON-chunk-only
patch — the BIN chunk is copied byte for byte, so every accessor, vertex, weight and sampler is
bit-identical and the paw audit carries over. The asset now ships the same eight clip names as every
other creature-expansion species, and no shared renderer file was touched.

### Lifecycle

`test-results/s05-fox-lifecycle/run3` (passed), against
`6c5c6329126b5800a62c79e766f4f2b6f5bdea85bfdff56dce5d003656342f00`: 8.04 m of natural travel,
1.18 rad of turning **while moving**, advancing Run, a `native-masked` two-bone
(`b_Neck_04`, `b_Head_05`) hit overlay over the continuing gait, a settled death pose captured with
`fade` 0 either side of the shutter, a natural `fox_guardhair` drop transferred by an ordinary
pointer pickup, 72 melee XP, 2 marks, respawn, and zero page and runtime errors.

Inspected frames: at gameplay distance beside the player the fox is correctly scaled (roughly
knee-height), all four paws bear weight, and the Run cycle shows a real gallop with a suspension
phase. The settled corpse lies on its side, grounded, head and brush clearly readable; the production
loot chest spawns over its midsection, which is ordinary game behaviour rather than an asset defect.

### Corpse framing, fixed properly

The first fox run produced a useless corpse frame: a fox is 1.5 m long and the swordsman standing
over it filled the shot. The detached inspection camera sits at `(sin yaw, cos yaw)` from its target
— measured, not assumed — so corpse frames now derive their yaw from the **killer's** azimuth:
`side` looks along the perpendicular to the player, `rear` the other perpendicular, `front` from
directly opposite. The yaw actually used is recorded with every capture.
## The four hoofed species: a death clip that fell through the world

The handoff said Horse, Moose, Bighorn and Tapir had integrated whole-body helpers and corrected
Death clips in source that had never been exported. Re-exporting them with
`tools/build-creature-expansion.ts` and measuring both builds turned that claim into a number.

`tools/creature-expansion/mammals/clip-floor-audit.mjs` (new) samples every clip at each animation
key time and each interval midpoint and reports the lowest **skinned world Y** over all vertices, plus
how much of the clip the whole body spends more than 1 cm off the ground. Bone tips would have missed
all of this.

| Species | Shipped Death: lowest Y | Shipped Death airborne | New Death: lowest Y | New airborne |
| --- | --- | --- | --- | --- |
| Marsh Moose | **-0.880 m** | 26.2% of samples | +0.0012 m | 0 |
| Marchwild Horse | **-0.625 m** | 12.8% | +0.0015 m | 0 |
| Cairn Bighorn | **-0.453 m** | 29.0% | +0.0015 m | 0 |
| Bracken Tapir | **-0.451 m** | 30.8% | +0.0007 m | 0 |

Every shipped hoofed animal sinks between 45 and 88 cm through the ground as it dies, and spends a
sixth to a third of that clip fully airborne. All seven other clips were already fine on both builds
and stay fine. This is the single largest visible defect found this round.

That broken Death also poisoned the manifest bounds, because `deformedBounds` measures across every
clip: the shipped Bighorn recorded a 1.062 m width and the Tapir a 1.487 m height that only existed
because their corpses flailed underground. The re-exports measure 0.741 m and 1.123 m, which is why
their derived pack radii move down rather than because anything shrank.

All four passed the full natural lifecycle on hardware
(`test-results/s05-hoofed-lifecycle/`), each with an ordinary drop and pickup: `bighorn_fleece`,
`horse_tailhair`, `moose_antler_palm`, `tapir_leather`. Inspected corpses all lie flat on their side,
grounded, with folded legs — moose antlers and bighorn horns resting on the ground rather than
skewering it.

One honest caveat recorded rather than smoothed over: the Bighorn's legs are noticeably spindly under
a barrel body, and the re-exported Tapir is leaner with smaller ears than the one it replaces
(`test-results/s05-hoofed-shipped/` holds the before frames). Neither is a regression introduced here
— both are the current authored anatomy — and neither outweighs a corpse that falls through the
floor, but both are worth another art pass.

## The badger and porcupine source lines should be abandoned

The held rat-derived Badger and Porcupine were compared against what the game actually ships today,
on the same hardware, same camera, same frame
(`test-results/s05-mammal-views/` versus `test-results/s05-shipped-mammals/`). The comparison
reverses the previous assumption:

- **Shipped Badger**: low broad body, white facial blaze, grizzled grey back, dark legs with visible
  digging claws, feet planted. It reads as a badger.
  **Rat-derived candidate**: head buried in the ground, body slumped flat, legs splayed. It reads as
  an animal dying, in its idle. 5 930 triangles.
- **Shipped Porcupine**: banded quills sweeping back over a heavy rump, short legs, small dark feet,
  blunt snout, quilled tail, feet planted. It reads as a porcupine.
  **Rat-derived candidate**: good quill mantle, but a crouched idle with no weight-bearing feet and a
  naked pink rat tail that no porcupine has.

Both shipped models are also clean on the floor audit across all eight clips. The considerable
remaining work on the rat-derived line - per-limb contact repair, re-posing, tail replacement - would
buy a result worse than what is already in the game. Recommendation: stop that line and spend the
effort on the Lynx, which is the one shipped mammal that genuinely is bad.

## A defect sweep outside this slice

`clip-floor-audit.mjs` was run over the other shipped creature-expansion species while it was to
hand. These are **not** this slice's creatures and nothing was changed about them; they are recorded
so their owners can decide. Lowest skinned world Y, and the fraction of samples where the whole body
is more than 1 cm airborne:

| Species | Finding |
| --- | --- |
| `reedbank_goose` | Death reaches -0.226 m; every one of its eight clips sinks between 1.9 and 4.7 cm |
| `antler_beetle` | Death is airborne for 53.6% of its samples - the beetle dies hovering |
| `reedjaw_crocodile` | all eight clips sink 2.1 to 5.0 cm |
| `quarry_snail` | Death -0.053 m, Idle and Walk 1.3-1.5 cm |
| `kiln_salamander` | Walk, Run and Death sink 1.5-1.6 cm |
| `marchfield_turkey`, `scree_bustard` | Death airborne 5-6% of samples |

`duskoak_lynx`, `rootdelve_badger`, `quillback_porcupine`, `slateback_tortoise` and
`blackwater_heron` are clean.

## Shared and production files touched

- `game/public/assets/manifest.json` and six creature GLBs — `creature_ashscale_monitor`,
  `creature_redbrush_fox`, `creature_cairn_bighorn`, `creature_marchwild_horse`,
  `creature_marsh_moose`, `creature_bracken_tapir` — only through
  `tools/creature-expansion/mammals/promote-candidate.mjs`, added here as this slice's promote
  helper. It refuses to move anything whose staged bytes, SHA-256, production path, declared pack,
  Creative Commons metadata or lifecycle evidence hash does not check out, and it stamps the evidence
  path into the manifest entry's `acceptance` block.
- `game/src/content/regionalPacks.ts` — four pinned pairs of numbers, all derived from the assets'
  own manifest bounds and all recomputed by `tests/regional-packs.test.ts`. Leaving any of them stale
  fails the suite and misstates the actor's footprint to melee spacing.

  | Pack source | nativeBodyRadius | nativeVisualRadius |
  | --- | --- | --- |
  | `ashscale_monitor_residents` | unchanged 2.3840643191337585 | 3.126749966751312 → 3.1445374043543763 |
  | `redbrush_fox_residents` | 1.2132761287689209 → 0.7671434755255592 | 1.37619566011836 → 0.8766702550812312 |
  | `marchwild_horse_residents` | 1.6627995989690856 → 1.550673290217461 | 1.8479814802167864 → 1.7794178954964508 |
  | `cairn_bighorn_residents` | 1.1879706740379334 → 1.1665486181705864 | 1.4651450990704056 → 1.3731898101282751 |

  The fox drops sharply because the procedural fox it replaces was a 2.43 m long, 0.42 m wide body
  and the source-derived one is a correctly proportioned 1.53 m. The horse and bighorn drop because
  their old bounds included a corpse sunk through the floor. Moose and Tapir have no
  `REGIONAL_PACK_SOURCES` row, so nothing to repin.
- The manifest gains the `khronos-fox-complete-source` pack, `CC-BY-4.0`, with the pinned upstream
  archive hash `d97044e701822bac5a62696459b27d7b375aada5de8574ed4362edbba94771f7`, full attribution
  and a retained derivative licence. The promote helper runs the production
  `validateCcAssetPack` over it before copying a byte.
- The `corealm-creature-expansion` pack's `generatorSha256` was stale (`9a42f48a…` against a
  `tools/build-creature-expansion.ts` that hashes `eb76f575…`). The Monitor promotion refreshed it
  to the real value, which is what `validateManifestPack` checks.
- `tests/cc-asset-license.test.ts` — the CC-BY-4.0 case added in the previous round's checkpoint did
  not typecheck (excess-property checks on two inline object literals). Hoisted into locals; the
  assertions are unchanged.

`contracts.ts`, `app/boot.ts`, `world/regionBuilder.ts`, save schemas, `content/enemies.ts`,
`items.ts`, `equipment.ts`, `recipes.ts`, `regions.ts`, `render/entityViews.ts`, `materials.ts`,
`assets.ts`, `systems/combat.ts`, `enemyAI.ts` and `tools/build-assets.ts` were not modified. The
Fox's `Survey`→`Idle` rename exists precisely so that the renderer's clip table did not have to be.

All six species' habitat rows in `content/creatureHabitats.ts` remain `enabled: false` and
`proposed_pending_lab_and_world_acceptance`. Lab acceptance does not by itself place a species in the
world, so every promoted manifest entry records `worldIntegrated: false`.

## Cleanup

Deleted (superseded, all regenerable from the retained generator and its pinned input):

- `art/rebuild/candidates/finish-quadrupeds/fox-paws-v3-comparison/` — the pre-rename staging batch,
  superseded by `fox-paws-v3-idle-comparison/` which holds the promoted bytes.
- `art/rebuild/candidates/finish-quadrupeds/source-feline/*.npz` — intermediate weight-fit,
  corrective-fit and baked-validation numeric dumps, ~400 MB. **Three were restored immediately**:
  `actor2-weight-fit-data.npz`, `actor2-weight-random-data.npz` and `actor2-bake-data.npz`.
  `PAUSED-ACTOR2-CHECKPOINT.md` names them as the current training data that `fit_correctives.py
  --actor2` needs to resume the held Lynx, so deleting them was wrong. What stays deleted is the
  actor1/revision1 lineage (its handoff is marked FAILED), the `*-baked-validation-errors.npz`
  output dumps, and `actor2-corrective-fit.npz`, which that same checkpoint explicitly marks stale
  and forbids rebuilding from.
- `art/rebuild/candidates/finish-quadrupeds/source-porcupine/contact-*-readback.json` — per-frame
  contact readback dumps from superseded IK iterations, ~400 MB.
- `art/rebuild/candidates/finish-quadrupeds/source-bighorn-sheep/v2/` and `v3/`, and
  `source-moose-horse/revision2/` — superseded revisions; the latest of each is kept.
- `*.blend1` Blender autosaves under `source-bighorn-sheep/` and `source-tapir-horse/`.

Kept deliberately: every source snapshot and `provenance.json`, the accepted staging catalogues, the
`paws-v2`/`paws-v3` generators and reviews, and everything the manifest references.

## Checks

`npm run typecheck` passes.

The full vitest suite was run with the promotions in place and again with them stashed. Both runs
fail exactly the same 16 files and 25 tests, so every one of those failures is pre-existing on this
branch and none is caused by this work. Named for the record: `creature-gait`, `creature-motion-continuity`,
`humanoidGait`, `coastal-traversal`, `renderer-frame-timing`, `structure-movement-grounding`,
`sunder-ledge-geology`, the three shortcut-source suites, and the five `tools/creature-motion`
gait suites. Everything touching creatures, packs, provenance, habitats and spacing passes:
`regional-packs`, `cc-asset-license`, `creature-habitats`, `enemy-habitat-behavior`, `meleeSpacing`,
`gathering-provenance`, `encounter-dressing`, `rpg-regional-packs`, `creature-hit-overlay`,
`animation-budget`, `art-direction`, `corpseFade`.

No performance measurement was taken and none is claimed.
