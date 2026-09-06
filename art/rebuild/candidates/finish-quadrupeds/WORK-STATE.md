# Quadruped work state

**Six creatures are now accepted and promoted.** See
`runs/corealm-rebuild/SLICE-05-CREATURE-REPLACEMENTS.md` for the full decision table, measurements
and evidence paths; that file, not this one, is the durable record.

- **Ashscale Monitor** — promoted at
  `81aa4269996482a5ca3f752b1a50ca8830f0449cded062d817c588d73bddf00e`. The revision8 direction was
  already approved; what it needed was the moving lifecycle and the settled death pose, both of which
  now pass on hardware. The generator sources still hash to the values pinned in
  `monitor-promotion.json`.
- **Cairn Bighorn, Marchwild Horse, Marsh Moose, Bracken Tapir** — re-exported from the corrected
  hoofed sources and promoted. Every shipped version's Death clip sank 45–88 cm through the ground and
  spent 13–31% of the clip fully airborne, measured over all skinned vertices with
  `clip-floor-audit.mjs`. The re-exports never leave the ground. Staged in `hoofed-death-export/`.
  Their old manifest bounds were inflated by that broken corpse, which is why the derived pack radii
  went down.
- **Redbrush Fox** — promoted at
  `6c5c6329126b5800a62c79e766f4f2b6f5bdea85bfdff56dce5d003656342f00`, built from the complete Khronos
  source: `Fox.adaptive-actor.glb` → `paws-v2.mjs` → `paws-v3.mjs` (padded four-lobed paws) →
  `rename-idle.mjs` (`Survey` → `Idle`). Staged in `fox-paws-v3-idle-comparison/`.

`paws-v2` did NOT fix the paws and never claimed to: its own review reports `visualAcceptance: false`.
Its contact patch is byte-for-byte the same shape as the unmodified adaptive actor's, because it froze
the contact vertex set. `fox-paws-v2-comparison/` also stages a stale earlier iteration whose hash does
not match `Fox.paws-v2.glb` on disk. Do not treat either as evidence.

Everything below this line is the state of the creatures that are still HELD. KEEP is a source
retention decision, not acceptance.

## Held creatures

The user prefers free, properly licensed whole-body source bases over repeated procedural rebuilding.
The Fox is the worked example of that approach paying off; the rest follow the same route.

- `source-feline/`: complete JonasDichelle Cat, CC BY 3.0, from an attributed public mirror. Whole-cat
  adaptation base for the Lynx, not an accepted Lynx. The newer Lynx actor
  `fcc4296906bfeec04b9b2c650639a150238d2bccf14b2ec45b427ade1453b2d5` has unlabelled Walk/Run residual
  maxima of 3.372/9.289 m/s near support release and generic blends that bury vertices by 139/157 mm.
  Do not cite it as contact-ready. The `.npz` weight-fit and baked-validation dumps were deleted; they
  are regenerable intermediates.
- `source-porcupine/`: original CDmir/TinyWorlds CC0 rat from OpenGameArt, packed textures, 14 source
  actions (13 real after the corrected release drops the discontinuous long Idle.000). Porcupine
  original-rig continuous IK v2 preserves bone lengths and ~19.375% Run flight but still slides
  2.138/3.354 m/s at real near-floor toe contacts. The per-frame `contact-*-readback.json` dumps were
  deleted; they are regenerable.
- `source-badger/`: axonite taxidermy scan is the strongest provenance lead, 410,286 triangles,
  CC BY 4.0; preview and authorized download still outstanding. The Gonsplitters/mz4250 badger remains
  provisional — publisher declares CC-BY-SA4 but the original creator grant and mesh identity are not
  independently verified, so no deep derivative is authorized. A separate CC0 rat-derived badger
  (`7e2b87920ac035d6a9886ad3c35a050fee7e6097fd5a1bb75e76702e2bd59bf0`) penetrates ~52/17/60 mm on
  Walk/Run/Die.
- `source-bighorn-sheep/`: p0ss Sheep2, CC-BY-SA-3.0, accepted for adaptation with attribution and
  share-alike records. v4 is the current revision; v2 and v3 were deleted as superseded. Source motion
  is contact-rejected; v4 is an anatomy candidate only. Note the promoted Bighorn is the ORIGINAL
  Corealm-authored one, not this; the sheep-derived line is still an open art experiment. The
  promoted Bighorn's legs are noticeably spindly under a barrel body and deserve another pass.
- `source-moose-horse/` and `source-tapir-horse/`: Lyndon Daniels CC0 horse (ChadM's rigged derivative
  also CC0). The native armature has no actions and lacks `Bone.005` despite 330 body vertices being
  dominated by that group; mane, tail and eyes need binding. `revision3` is current for the Moose;
  `revision2` was deleted. Do not claim the source rig is gameplay-ready.
- `source-hoofed/`: Horse, Moose, Bighorn and Tapir have integrated whole-body helpers and corrected
  Death clips that pass eight-clip full-skinned CPU audits and a 321-pose Death sweep
  (`test-results/hoofed-full-skin-audit.json`, `hoofed-death-audit.json`), but have not been exported
  since that source change.

All 18 locally cached Unity archives were inspected; none contains an exact complete Fox, Lynx, Badger
or Porcupine. No login bypass, purchase or unverified entitlement was used at any point.

## How to prove the next one

The Monitor and Fox both went the same way, and it is the shortest honest route:

1. Measure the actual defect on skinned vertices in metres. `paw-contact-audit.mjs` does feet;
   `death-settle.mjs` says when a Death clip really stops moving.
2. Give the mesh work to Codex as one bounded task with numeric acceptance targets, then re-measure
   the result yourself with the project's own audit rather than reading its report.
3. Freeze the bytes into a staging catalogue — the hash is validated on load, so the review is stable
   even if the generator runs again.
4. Capture hardware gallery and close views, then run
   `tools/creature-expansion/mammals/lifecycle-proof.ts` against port 4181.
5. Promote only through `tools/creature-expansion/mammals/promote-candidate.mjs`, which requires the
   passing lifecycle report and checks its asset hash against the catalogue.
6. Update the derived `nativeBodyRadius`/`nativeVisualRadius` pins in `regionalPacks.ts`; the manifest
   bounds move when the bytes do.
