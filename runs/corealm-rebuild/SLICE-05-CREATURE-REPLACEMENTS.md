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
| Duskoak Lynx | Deferred | Cat-derived actor still has 3.37/9.29 m/s stance-release slip and 139/157 mm blend burial. Not started this round. | `art/rebuild/candidates/finish-quadrupeds/CURRENT-SOURCE-HANDOFF.md` | JonasDichelle Cat, CC-BY-3.0 (base only) |
| Rootdelve Badger | Deferred | CC0-rat-derived candidate penetrates ~52/17/60 mm on Walk/Run/Die. Not started this round. | same | CDmir/TinyWorlds rat, CC0-1.0 (base only) |
| Quillback Porcupine | Deferred | Rat-derived candidate slides 2.14/3.35 m/s at real toe contacts. Not started this round. | same | CDmir/TinyWorlds rat, CC0-1.0 (base only) |
| Cairn Bighorn | Deferred | Sheep-derived v3 is a CPU-still anatomy candidate; source motion is contact-rejected. | same | p0ss Sheep2, CC-BY-SA-3.0 (base only) |
| Bracken Tapir | Deferred | Horse-derived head/ear/toe revision only checked in CPU stills. | same | Lyndon Daniels horse, CC0-1.0 (base only) |
| Marchwild Horse / Marsh Moose death clips | Deferred | Corrected Death clips exist in source but have not been exported since; Moose still has unresolved `Bone.005` mapping. | `test-results/hoofed-death-audit.json` | Lyndon Daniels horse, CC0-1.0 |

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
## Shared and production files touched

- `game/public/assets/manifest.json`, `models/creature/creature_ashscale_monitor.glb` and
  `models/creature/creature_redbrush_fox.glb` — only through
  `tools/creature-expansion/mammals/promote-candidate.mjs`, added here as this slice's promote
  helper. It refuses to move anything whose staged bytes, SHA-256, production path, declared pack,
  Creative Commons metadata or lifecycle evidence hash does not check out, and it stamps the evidence
  path into the manifest entry's `acceptance` block.
- `game/src/content/regionalPacks.ts` — two pinned pairs of numbers, both derived from the assets'
  own manifest bounds and recomputed by `tests/regional-packs.test.ts`:
  `ashscale_monitor_residents.nativeVisualRadius` 3.126749966751312 → 3.1445374043543763 (body radius
  unchanged), and `redbrush_fox_residents` 1.2132761287689209 / 1.37619566011836 → 0.7671434755255592 /
  0.8766702550812312. The fox pin drops sharply because the replaced procedural fox was a 2.43 m long,
  0.42 m wide body; the source-derived one is a correctly proportioned 1.53 m. Leaving either pin
  stale would fail the suite and misstate the actor's footprint to melee spacing.
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

Both species' habitat rows in `content/creatureHabitats.ts` remain `enabled: false` and
`proposed_pending_lab_and_world_acceptance`. Lab acceptance does not by itself place a species in the
world, so both promoted manifest entries record `worldIntegrated: false`.

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

The full vitest suite was run twice, once with the promotions in place and once with them stashed.
Both runs fail the same 16 files, so every one of those failures is pre-existing on this branch and
none is caused by this work. Named for the record: `creature-gait`, `creature-motion-continuity`,
`humanoidGait`, `coastal-traversal`, `renderer-frame-timing`, `structure-movement-grounding`,
`sunder-ledge-geology`, the three shortcut-source suites, and the five `tools/creature-motion`
gait suites. Everything touching creatures, packs, provenance, habitats and spacing passes:
`regional-packs`, `cc-asset-license`, `creature-habitats`, `enemy-habitat-behavior`, `meleeSpacing`,
`gathering-provenance`, `encounter-dressing`, `rpg-regional-packs`, `creature-hit-overlay`,
`animation-budget`, `art-direction`, `corpseFade`.

No performance measurement was taken and none is claimed.
