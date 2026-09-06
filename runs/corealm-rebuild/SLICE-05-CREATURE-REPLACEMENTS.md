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
| Redbrush Fox (`creature_redbrush_fox`) | **Held** | Body, coat and gameplay-distance read are good on the complete Khronos source adaptation, but the paws are still wrong. See below. | `test-results/s05-fox-v2-views/`, `test-results/s05-fox-v2-close/`, `art/rebuild/candidates/finish-quadrupeds/source-fox-adaptation/paws-v2-review.json` | Khronos glTF-Sample-Assets Fox — PixelMannen (model, CC0-1.0), tomkranis (rig/animation, CC-BY-4.0), @AsoboStudio and @scurest (glTF conversion, CC-BY-4.0) |
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

The four earlier attempts all failed on harness timing, not on the asset.

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

## Redbrush Fox — why it is still held

The complete Khronos Fox adaptation is the right base and the user's preference for a licensed
whole-body source over another procedural rebuild is being honoured. Side, rear and gameplay-distance
views all read clearly as a red fox: narrow chest, pointed muzzle, tall ears, dark stockings, a
white-tipped brush. The defect is entirely in the paws, and the previous round's `paws-v2` did not
fix it.

Measured with `tools/creature-expansion/mammals/paw-contact-audit.mjs` (new; contact patch = skinned
vertices within 3 mm of that foot's lowest skinned vertex, region = at least half the skin weight on
the terminal joint):

| Foot | Contact patch | Width in 8 rear→front slices |
| --- | --- | --- |
| `b_RightHand_08` / `b_LeftHand_011` | 4.73 × 7.59 cm | 4.73 / 4.46 / 2.42 / 1.09 / 0 / 0.58 / 0 / 0.34 cm |
| `b_LeftFoot02_018` / `b_RightFoot02_022` | 4.93 × 6.52 cm | 1.26 / 2.61 / 3.83 / 4.93 / 4.66 / 4.26 / 3.80 / 1.95 cm |

The front 60% of the forepaw footprint is a near-zero-width spike, which is exactly what the close
hardware views show: a pointed flat shoe rather than a padded four-toed paw.

Two things about the previous round's checkpoint are worth recording, because both would mislead
anyone who trusted it:

- `paws-v2-review.json` reports its own `visualAcceptance: false`,
  `fourDistinctRoundedToeLobesAccepted: false` and `soleOutlineTargetAccepted: false`. It was never
  claimed as a fix.
- `fox-paws-v2-comparison/catalogue.json` stages `482ba174aca63cb7c5eda5c0f56b5a5feff9a45d4a09abb37d983bd6859c6466`,
  but `Fox.paws-v2.glb` on disk now hashes to
  `2859acf0777b4882f78c99e6b9aac95d5da7f4fe845cc8ab3d48749fee1b3e48`. The staged bytes are a **stale
  earlier iteration**. Both files, and the underlying `Fox.adaptive-actor.glb`, measure an identical
  contact patch, because `paws-v2` froze the contact vertex set exactly and could therefore only add
  volume above the sole. The pointed footprint survived every iteration.

Fixing this means releasing the horizontal half of that constraint: contact vertices keep their bind
world Y (so ground contact height and the clip floors are preserved) but may move in X and Z to form
a rounded oval footprint with three shallow clefts and four toe lobes. That reshape is in progress
and has not produced a candidate that passes its own measured shape targets yet, so nothing about the
Fox is promoted.

## Shared and production files touched

- `game/public/assets/manifest.json` and `game/public/assets/models/creature/creature_ashscale_monitor.glb`
  — only through `tools/creature-expansion/mammals/promote-candidate.mjs`, added here as this slice's
  promote helper. It refuses to move anything whose staged bytes, SHA-256, production path, declared
  pack, Creative Commons metadata or lifecycle evidence hash does not check out, and it stamps the
  evidence path into the manifest entry's `acceptance` block.
- `game/src/content/regionalPacks.ts` — one number. `ashscale_monitor_residents.nativeVisualRadius`
  is a pin derived from the asset's own manifest bounds, and `tests/regional-packs.test.ts` recomputes
  it; the new bytes moved it from 3.126749966751312 to 3.1445374043543763. `nativeBodyRadius` was
  unchanged. Leaving the pin stale would have failed the suite and understated the actor's footprint.
- `tests/cc-asset-license.test.ts` — the CC-BY-4.0 case added in the previous round's checkpoint did
  not typecheck (excess-property checks on two inline object literals). Hoisted into locals; the
  assertions are unchanged.

`contracts.ts`, `app/boot.ts`, `world/regionBuilder.ts`, save schemas, `content/enemies.ts`,
`items.ts`, `equipment.ts`, `recipes.ts`, `regions.ts`, `render/entityViews.ts`, `materials.ts`,
`assets.ts`, `systems/combat.ts`, `enemyAI.ts` and `tools/build-assets.ts` were not modified.

The Monitor's habitat rows in `content/creatureHabitats.ts` remain `enabled: false` and
`proposed_pending_lab_and_world_acceptance`. Lab acceptance does not by itself place the species in
the world, so the promoted manifest entry records `worldIntegrated: false`.

## Checks

`npm run typecheck` passes. Focused vitest: `cc-asset-license`, `regional-packs`, `creature-habitats`,
`enemy-habitat-behavior`, `meleeSpacing`, `creature-hit-overlay`, `corpseFade`.

`tests/creature-gait.test.ts` fails on this branch **and on the unmodified parent commit**, on hens
and geese cadence ceilings. It is pre-existing and unrelated to anything here.

No performance measurement was taken and none is claimed.
