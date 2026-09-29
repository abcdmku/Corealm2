# Creature rig pipeline

This pipeline re-rigs and re-animates Tripo-generated production creatures in headless Blender (the `bpy` module). It keeps the production mesh, UVs, materials and textures. It replaces the skeleton, the skin weights and the clips.

## Run

```sh
node tools/creature-rig/run.mjs <assetId> [<assetId> ...] [--from intake|rig|assemble|review]
```

Every asset needs `tools/creature-rig/assets/<assetId>.json` with `{ "class": "humanoid", "profile": "brute" }`. The file can also set `source` (a forced source GLB) and `profileOverrides`.

Blender runs as `py -3.13` with `PYTHONPATH=D:/CorealmAgentCache/bpy-5.2`. To use a different interpreter or bpy location, set `CREATURE_RIG_PYTHON` and `CREATURE_RIG_BPY`.

Output goes to `test-results/creature-motion/rig/`, which git ignores:

| Path | Contents |
|---|---|
| `work/<id>/` | `mesh.glb` (bind-pose production mesh), `intake.json`, `rig.json`, `fit.png` (skeleton and dominant-bone weights), `validation.json` |
| `models/<production path>` | The candidate GLB |
| `sheets/{side,front,three-quarter}/` | Contact sheets that compare the candidate (`[0]`) with production (`[1]`) |
| `sheets/closeup/<id>.png` | Joint close-ups: rows are the bind pose, then Idle, Walk, Run and Attack at 2 phases each; columns are front and side views of `upperarm_l`, `lowerarm_l`, `thigh_l`, `calf_l` and `spine_02` |
| `catalog.json` | Entries that `tools/promote-finish-assets.ts` can read, with `motionProvenance` and clip seconds |

## Steps

1. **`intake.mjs`** bakes every production mesh node to its bind pose in world space. It grounds the lowest vertex at y=0 and centres the feet over the origin. It then searches `assets/art/tripo/**` and `~/Downloads` for a source export with the same geometry. A source rig is used only if it passes `rig-health.mjs`: bind-consistent, at most 60% rigid vertices, no root- or `neutral_bone`-dominated weight, and at least 12 weighted joints. Rig-page 8k exports always fail these gates.
2. **`py/rig.py`** runs in Blender:
   - `crlib/body.py` voxelises the mesh. It seals holes with the smallest closing that stops the solid from growing, and removes thin sheets. It finds extremities and limb paths as medial geodesics, and cuts contacts between parts that only touch.
   - The class module fits the skeleton. It then adds cloth or tail chains.
   - Blender computes bone-heat weights. These are filled, made rigid only for loose pieces that are mostly bound to one bone, smoothed in 2 passes, limited to 4 influences and normalised.
   - A T-posed body is re-bound with its arms at 50° using dual-quaternion skinning (`crlib/rebind.py`).
   - Donor clips are sampled at 30 fps and retargeted (`crlib/retarget.py`).
3. **`assemble.mjs`** writes the GLB:
   - Joint rest equals the bind pose, and the inverse bind matrices are exact.
   - Production vertices take the weights of the merged vertex at their position, so UV seams never crack.
   - All clips use LINEAR rotation keys.
   - Only the hips have translation keys.
   - No clip has scale keys.
4. **`validate.mjs`** measures every clip against the bind pose:
   - edge stretch and compression percentiles
   - volume
   - non-root bone length change (must be 0)
   - scale and translation channels
   - loop seam
   - planted-foot ground speed, its spread and sideways drift

   You can also pass it a production file for comparison. It removes a uniform presentation scale first.
5. **Review.** The review step renders the contact sheets and the close-ups and stages the catalog entry. Look at every sheet. The numbers alone do not accept a candidate.

## Retarget rules

- Limbs (`follow: 1`) take the donor bone's world orientation. The target rest frame is the donor rest frame rotated onto the target bone. This matches a T-pose or A-pose rest to the donor's rest before transfer, and it carries bone roll over.
- Torso, head and feet (`follow: 0`) add the donor's motion on top of their own rest. A hunched back stays hunched, and a sole that is flat at rest stays flat.
- The hips translate by the donor offset times the leg-length ratio. Loop clips have their net horizontal travel removed.
- Foot IK solves two-bone IK to the donor's scaled ankle path. It then pitches the foot and toes so the ball and toe tip follow the donor's scaled heights. This is exact while the donor foot is in contact and otherwise only stops the foot sinking.
- Chains with no donor twin are driven by a damped Verlet spring chain. These are capes (back sheets, plus their part above the hips that stands off the body), front flaps between the legs, and tails. The leg and torso capsules and the floor are colliders. The columns of one sheet are linked so the sheet cannot tear. Loops run for 3 cycles, and the leftover difference is spread over the cycle.
- Lying clips (the hips drop below half their height) lift the hips by a smooth envelope of the floor penetration. No clip snaps to the floor per frame.
- Takes that are authored to chain play as one clip, for example `["Melee_Hook", "Melee_Hook_Rec"]`.

## Classes

A class is one module and one donor map. They are found by name, so adding a class edits no shared file:

- `py/classes/<class>.py` must define `fit(body, donor, profile, source=None) -> (Skeleton, notes)` and `plan(sk, body, profile)`. It may also define:
  - `cloth(body, sk, profile, heat) -> override`
  - `bind_turns(sk, profile)`
- `py/classes/<class>.donors.json` lists the donors (a zip and member, or an extracted file) and the profiles (clip choices per state, `legs`, overrides).

| Class | Profile | Donor | Idle | Walk | Run | Attack | Hit | Death |
|---|---|---|---|---|---|---|---|---|
| humanoid | knight | UAL1 | Idle_Loop | Walk_Loop | Jog_Fwd_Loop | Sword_Attack | Hit_Chest | Death01 |
| humanoid | brute | UAL1 + UAL2 | Idle_Loop | Walk_Loop | Jog_Fwd_Loop | Melee_Hook + Melee_Hook_Rec | Hit_Chest | Death01 |
| humanoid | spirit (`legs: false`) | UAL1 | Idle_Loop | Walk_Loop | (none; falls back to Walk) | Spell_Simple_Enter + Shoot + Exit | Hit_Chest | Death01 |

The spirit profile has no leg bones. A 3-bone tail chain runs from the waist to the lowest tip.

The Quaternius Universal Animation Library (CC0) is extracted from `C:/Users/Borg/Documents/GitHub/Corealm/.asset-cache` into the work area. Donor files are never copied into the repo.

## Known limits

- The healthy-source path (landmarks from a Tripo skeleton) is implemented but no humanoid creature in the manifest has a healthy source. Every Tripo humanoid export on disk that matches a production mesh fails the bind gate, so all three proofs used the fitted path.
- Joint placement uses measured features. Unusual anatomy can still misplace a joint, so check `fit.png` for every new asset. A floating body's waist uses the biped ratio between the shoulders and the hand tips.
- The shoulders and armpits of a T-posed body are re-bound to 50° with dual quaternions. Extreme overhead poses still pinch.
- Cloth is a spring chain, not a cloth solver. Wide capes get 2 linked columns. Stretch percentiles on very fast clips (Run, the Sword_Attack spin) are dominated by the cape.
- The Sword_Attack and Death01 clips travel. That travel is kept, and in-place removal applies only to loops.
- No-root-motion clips report ground speed in `validation.json`. The runtime move speed should match it; the root owns that table.
