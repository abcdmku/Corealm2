# Slice 04: retained monster animations

All fourteen retained monsters are promoted across the four world regions. The
skeleton family got new Hit clips because its old ones produced no reaction at
all. The Iron Golem got a material-only correction. Everything else promoted its
existing reviewed bytes after a fresh state-aware lifecycle on hardware.

Nothing here is world-placed. Every promoted asset keeps `worldIntegrated=false`.

## The skeleton hit defect

`Hit`, `HitLeft` and `HitRight` for the three skeletons were authored as a
whole-body lean on `Bip001`, which is the non-joint root node. The runtime hit
reaction is a masked additive overlay: it blocks the root, the pelvis, and the
spine link the thighs hang from, plus every leg joint and their ancestors. A
lean on the root is therefore entirely masked away. The Skeleton Soldier fell
through to the synthetic neck-nod fallback and the archer and mage showed arm
motion only.

The fix is in the animation source, not the runtime. `joint-recoil.mjs` authors
the recoil on `Bip001_Spine1`, `Bip001_Neck`, `Bip001_Head`, the clavicles and
the arms, over the source idle pose, keeping the existing key times and envelope
so combat timing is unchanged. The root's rotation becomes the constant Idle@0
value. Archer and mage keep their authored bow and staff grip arm tracks and
take the recoil multiplied on top, so the weapon stays gripped through the
reaction.

`rewrite-hit.mjs` applies this to the three frozen GLBs as an append-only BIN
rewrite. Measured against the frozen inputs, the BIN, accessors, nodes, skins,
meshes, materials, images, textures, samplers, scenes and the other five clips
are unchanged; only the rewritten sampler data differs.

Verified independently of the authoring tool by loading each candidate GLB and
running the actual production `createMaskedHitOverlay`:

| Model | Before | After | Head recoil | Protected drift |
| --- | --- | --- | --- | --- |
| Skeleton Soldier | `safe-fallback`, 1 synthetic track | `native-masked`, 7 tracks | 5.75 cm | 0 |
| Skeleton Archer | — | `native-masked`, 9 tracks | 5.75 cm | 0 |
| Skeleton Mage | — | `native-masked`, 9 tracks | 5.75 cm | 0 |

Head recoil is measured at the overlay's own peak weight against the Idle@0
pose. Protected drift is the maximum world-matrix change across every bone the
mask protects, sampled the same way the existing overlay test does.

The masks the browser resolved at runtime match those bone lists exactly. The
clavicle tracks the authoring pass writes are dropped by the mask, because
`Clavicle` matches none of its upper-body name patterns. That costs nothing and
was left alone rather than widening a shared runtime pattern for one rig.

## Iron Golem material

The root critic said iron read as brown stone. Round 1 over-corrected into
bright polished chrome: albedo about [158,164,167], roughness 0.43, metalness
0.97, almost no oxidation. Round 2 is dark cast iron.

`tools/rpg-bestiary/iron-material-source/rewrite.mjs` now takes a preset. The
`round1` preset still reproduces the round 1 GLB byte for byte and asserts its
SHA, so the earlier candidate stays reproducible.

Round 2 measured: mean albedo [88.0, 92.0, 97.0], oxide on 17.2 percent of
pixels with a muted rust patina, metalness 0.88 falling to 0.35 in oxide,
roughness 0.58 rising to 0.85, normal strength 0.45 over the byte-identical
original normal PNG, no emissive anywhere.

Verified independently: against the frozen baseline the whole BIN chunk is
byte-identical, and `accessors`, `bufferViews`, `buffers`, `meshes`, `nodes`,
`skins`, `animations`, `scenes`, `samplers` and `asset` all hash identical. Only
`images`, `materials` and `textures` changed. The accepted silhouette and all
eight clips are untouched.

Fire Golem was not reopened; it already maps to the promoted Lava asset.

## Per-creature decisions

Every row below is `accept`. Lifecycle runs are the production combat lab on
ANGLE / NVIDIA RTX 5080 / D3D11, with real spell and melee damage, no health,
pose, position or clock overrides, and clean `getErrors` and page-error checks.

| Region | Species | Source | Evidence |
| --- | --- | --- | --- |
| Fallowmarch | goblin_scout | retained-unhorned15 | `test-results/slice04-lifecycle/goblin_scout/report.json` |
| Fallowmarch | goblin_archer | retained-unhorned15 | `test-results/slice04-lifecycle/goblin_archer/report.json` |
| Fallowmarch | goblin_shaman | retained-unhorned15 | `test-results/slice04-fallowmarch-recheck/goblin_shaman` |
| Fallowmarch | zombie | retained-unhorned15 | `test-results/slice04-fallowmarch-recheck/zombie` |
| Vellenwood | skeleton_soldier | retained-skeleton-hit-round1 | `test-results/slice04-vellenwood/skeleton_soldier` |
| Vellenwood | skeleton_archer | retained-skeleton-hit-round1 | `test-results/slice04-vellenwood/skeleton_archer` |
| Vellenwood | grave_ghoul | retained-unhorned15 | `test-results/slice04-vellenwood/grave_ghoul` |
| Vellenwood | wraith | retained-unhorned15 | `test-results/slice04-vellenwood/wraith` |
| Karrowmoor | stone_golem | retained-unhorned15 | `test-results/slice04-karrowmoor/stone_golem` |
| Karrowmoor | iron_golem | iron-material-round2 | `test-results/slice04-karrowmoor/iron_golem`, `test-results/slice04-iron-round2` |
| Kilnhalt | skeleton_mage | retained-skeleton-hit-round1 | `test-results/slice04-kilnhalt/skeleton_mage` |
| Kilnhalt | revenant | retained-unhorned15 | `test-results/slice04-kilnhalt/revenant` |
| Kilnhalt | plague_zombie | retained-unhorned15 | `test-results/slice04-kilnhalt/plague_zombie` |
| Kilnhalt | banshee | retained-unhorned15 | `test-results/slice04-kilnhalt/banshee` |

Nothing is held. The orchestrator can activate all four regions.

## State-aware capture

The two defects called out for this slice were short action captures reaching
Idle before the screenshot, and Death images caught mid-fall. Both are fixed.
Every run above captured its attack between 10 and 60 percent of the actual
Attack clip, its hit while the overlay weight was rising, and its corpse at the
final Death frame.

| Species | Attack at | Hit overlay phase | Corpse at |
| --- | --- | --- | --- |
| skeleton_soldier | 0.467 / 1.500 | 0.115 → 0.489 | 1.600 / 1.600 |
| skeleton_archer | 0.467 / 1.550 | 0.086 → 0.488 | 1.600 / 1.600 |
| skeleton_mage | 0.417 / 1.550 | 0.144 → 0.546 | 1.600 / 1.600 |
| grave_ghoul | 0.483 / 1.800 | 0.150 → 0.700 | 2.400 / 2.400 |
| wraith | 0.417 / 1.533 | 0.100 → 0.750 | 2.400 / 2.400 |
| stone_golem | 0.400 / 1.127 | 0.150 → 0.750 | 2.400 / 2.400 |
| iron_golem | 0.433 / 1.127 | 0.200 → 0.800 | 2.400 / 2.400 |
| revenant | 0.467 / 1.533 | 0.300 → 0.850 | 2.383 / 2.400 |
| plague_zombie | 0.600 / 1.800 | 0.150 → 0.800 | 2.400 / 2.400 |
| banshee | 0.300 / 0.500 | 0.250 → 0.900 | 2.400 / 2.400 |
| zombie | 0.500 / 1.800 | 0.300 → 0.950 | 2.400 / 2.400 |
| goblin_shaman | 0.333 / 0.500 | 0.150 → 0.800 | 2.400 / 2.400 |

Grave Ghoul and Zombie each needed a retry before landing inside the hit
overlay; both retries are preserved in their reports as `hit` then `hit-2`.

## Screenshots inspected

Read directly as images, not asserted by a test:

- Skeleton Soldier hit and settled corpse. The recoil tips the helmet and spine
  back and flings both arms out while the legs stay planted, with the base clip
  still reading Idle, which is the additive overlay behaving as designed. The
  corpse lies flat and fully settled.
- Skeleton Archer hit. Same recoil, bow retained.
- Skeleton Mage hit. Same recoil with the staff still gripped and upright,
  which is the point of preserving the authored arm tracks.
- Wraith hit and settled corpse, plus a wider corpse-side supplement.
- Grave Ghoul settled corpse. Knees and lower legs are present and connected,
  addressing the earlier ghoul-knee complaint.
- Iron Golem front and side in the gallery, round 1 against round 2, plus a
  live combat frame mid-Attack and its settled corpse. Round 2 reads as heavy
  weathered iron with edge highlights and oxide in the recesses, in both gallery
  and gameplay lighting.
- Zombie attack, mid-clip, a two-armed grasp lunge rather than an Idle frame.

## Code checks

`npm run typecheck` passes. Focused vitest: `creature-hit-overlay`,
`combat-hit-reaction`, `cc-asset-license`, `art-direction` all pass, 37 tests.
The overlay inventory walks every public character declaring `Hit` through the
actual `GLTFLoader`; it now covers 64 characters including all fourteen
promoted monsters, and every one resolves a nonempty `native-masked` overlay.

Manifest after promotion: 403 assets, 38 packs, zero missing files. Compared
against `e08d627`, this slice added exactly the fourteen creature entries and
changed or removed none.

## Limits

- `tests/creature-gait.test.ts` fails its cadence ceiling on nineteen world
  residents: hens, geese, bustards, scorpions, crabs and salamanders, all on the
  `return` gait. This is pre-existing on main, not caused by this slice. Their
  manifest entries are byte-identical to `e08d627` and none of the promoted
  monsters are world-placed, so they contribute no gait rows. It looks related
  to main's gait-preserving retarget and belongs to whoever owns that work.
- The `--corpse-only` supplement cannot pass for creatures with long Death
  clips. `corpseLinger` is the death clip plus 350 ms, then a 900 ms dissolve,
  so a 2.4 s Death leaves a 350 ms window where the corpse is both settled and
  unfaded. The supplement's walk-away does not fit in it and failed twice on the
  Wraith for that reason. The settled-corpse capture inside the main lifecycle
  does fit and passes its own fade gate, so that is the corpse evidence. The
  wider Wraith view in `test-results/slice04-vellenwood/wraith-corpse` was
  written before the assertion fired and shows the pose clearly, with a lab
  crate intersecting the hood. No assertion was weakened to make this pass.
- Skeleton Archer ran its whole lifecycle on the `sampled-rig` path rather than
  the live rig. The overlay was active at full weight and the recoil is visible,
  so this is extra evidence that the composition matches on both paths, but the
  live-rig path is unproven for that species specifically.
- Iron Golem round 2 was accepted on my own lab inspection. The previous two
  material rounds were both rejected by the root's fresh critic, so this
  direction deserves a confirming look before world activation.
- Plague Zombie and Banshee remain reskin variants of the zombie and wraith
  silhouettes rather than distinct bodies. That is a roster design question, not
  an animation defect, and it did not block promotion.
- Goblin Scout and Goblin Archer keep their pre-rebase lifecycle reports. Their
  bytes, manifest entries and overlay masks were re-verified after the rebase,
  but their browser lifecycle was not re-run. Goblin Shaman and Zombie were
  re-run and both pass, which is the evidence that the rebase did not disturb
  this family.
- No performance or frame-time claims. Other agents were running Chromium
  concurrently.

## Cleanup

Deleted as superseded, none promoted, frozen or manifest-referenced:
`source-round3`, `source-round4`, `source-round5`, `review2`,
`fantasy-wasp-round1`, `giant-rat-round1`, `troll-mauler-round1`. That is 175
files and about 341 MB; the content stays in git history.

Kept deliberately: `source-round6` is frozen so its gallery screenshots keep an
exact catalogue binding, `source-round7` is still under review,
`complete-source-round1` is referenced by
`tools/rpg-bestiary/replacement-inventory/complete-source-gaits.json`, and
`iron-material-round1` is referenced by `rewrite.mjs` as the round 1
reproduction baseline. All accepted catalogues, provenance and licenses are
untouched.
