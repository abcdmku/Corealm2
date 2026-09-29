# Creature rig pipeline

This pipeline re-rigs and re-animates Tripo-generated production creatures in headless Blender (the `bpy` module). It keeps the production mesh, UVs, materials and textures. It replaces the skeleton, the skin weights and the clips.

Studio bodies (a studio rig with good native takes) use [studio mode](#studio-mode) instead: it keeps the rig, the skin and every native clip byte-identical and only adds retargeted clips.

## Run

```sh
node tools/creature-rig/run.mjs <assetId> [<assetId> ...] [--from intake|rig|assemble|review] [--out <dir>]
```

- One asset's failure does not stop the batch. The failures are listed at the end and the exit code is 1.
- `--out <dir>` stages the work files, candidates, sheets and `catalog.json` under `<dir>`, so each worker can use its own folder. Donor extractions and the source-rig index stay shared in `test-results/creature-motion/rig/`.
- `--from rig` (or later) repeats the intake first when `intake.json` is missing or was made from another forced `source`, `bind` or production file.
- Re-rigging a body whose production file is already a promoted candidate starts from that candidate's mesh, including a re-bound (lowered-arm) bind. To reproduce a promoted candidate, run from the production file it was built from.

Every asset needs `tools/creature-rig/assets/<assetId>.json`:

| Key | Meaning |
|---|---|
| `class`, `profile` | The class module and its profile, for example `{ "class": "humanoid", "profile": "brute" }` |
| `source` | Optional forced source GLB for the intake |
| `bind` | `"rest"` bakes a skinned production mesh in its joints' rest pose instead of its skin bind, for a file whose bind is contorted but whose rest stands well. `{"clip": "Idle"}` bakes it in the first frame of that production clip, for a file whose bind and node rest are both contorted (Blender's importer shows the first clip's pose, which is why such a file looks fine there) |
| `profileOverrides` | Optional changes to the profile. Objects merge key by key, so `{ "clips": { "Walk": { "speed": 0.8 } } }` changes one field of one clip; anything else replaces. |
| `studio` | Runs [studio mode](#studio-mode) |
| `notes` | Free text |

`rig.py` reads `class`, `profile` and `profileOverrides` from this file on every run, so a config edit needs no new intake.

Blender runs as `py -3.13` with `PYTHONPATH=D:/CorealmAgentCache/bpy-5.2`. To use a different interpreter or bpy location, set `CREATURE_RIG_PYTHON` and `CREATURE_RIG_BPY`.

Output goes to `test-results/creature-motion/rig/`, which git ignores:

| Path | Contents |
|---|---|
| `work/<id>/` | `mesh.glb` (bind-pose production mesh), `intake.json`, `rig.json`, `fit.png` (skeleton and dominant-bone weights), `validation.json` |
| `donors/` | Donor files extracted from zips and Unity packages |
| `models/<production path>` | The candidate GLB |
| `sheets/{side,front,three-quarter}/` | Contact sheets that compare the candidate (`[0]`) with production (`[1]`) |
| `sheets/closeup/<id>.png` | Joint close-ups: rows are the bind pose, then Idle, Walk, Run and Attack at 2 phases each; columns are front and side views of the class's close-up joints (`closeup_joints()`, else `upperarm_l`, `lowerarm_l`, `thigh_l`, `calf_l` and `spine_02` where they exist, else the first joints of each limb kind) |
| `catalog.json` | Entries that `tools/promote-finish-assets.ts` can read, with `motionProvenance` and clip seconds |

## Steps

1. **`intake.mjs`** bakes every production mesh node to its bind pose in world space (a skinned node by joint world times inverse bind). Positions and normals are written as float, also when production stores them quantized (`KHR_mesh_quantization`). It grounds the lowest vertex at y=0 and centres the feet over the origin. It then searches Tripo's own exports (`assets/art/tripo/exports` and `~/Downloads`) for a source with the same geometry. `assets/art/tripo/imports/creatures` is not searched: it holds the retired repo rigs, which pass the gates but have hand-typed joints. A source rig is used only if it passes `rig-health.mjs`: bind-consistent, at most 60% rigid vertices, no root-dominated weight, at most 35% on `neutral_bone`, and at least 12 weighted joints. Rig-page 8k exports always fail these gates.
2. **`py/rig.py`** runs in Blender:
   - `crlib/body.py` voxelises the mesh. It seals holes with the smallest closing that stops the solid from growing, and removes thin sheets. It finds extremities and limb paths as medial geodesics, and cuts contacts between parts that only touch. A separate mesh piece that the cuts would leave unreachable (a forearm modelled as its own island) is joined again through its largest contact, if it is at least 1% of the core.
   - Upright classes pick the head, feet and hands with `crlib/landmarks.biped_tips()`:
     - The head is the highest midline tip, unless it rises more than 8% of the height above the top of the spine's column (an antenna, a branch or a horn). Then the column top is the head. The column is tracked slab by slab up from the torso and ends where it thins to a stalk.
     - The feet are the low tips whose medial paths from the head part lowest (at the crotch). Knuckles of arms that reach the floor part from the legs at the chest, so they are not feet.
     - The hands are the lateral tips farthest from the head along the body. Knuckles near the floor that are not on a leg count.
   - A generic source rig (`bone_0 … bone_N`) is labelled by `crlib/labels.py` (see below) and handed to the class as `source["labels"]`.
   - The class module fits the skeleton. It then adds cloth or tail chains.
   - Blender computes bone-heat weights (`crlib/skin.robust_heat`). When vertices come back unweighted, it retries on a welded copy (near-duplicate vertices make the solve singular), then on each loose piece (up to 150 pieces), then on the outer surface of the filled voxel solid, whose weights go to the render mesh by the nearest proxy points. The voxel proxy handles double-walled and non-manifold shells. `rig.json` records `skin.heatSource`. The weights are then filled, made rigid only for loose pieces that are mostly bound to one bone (and near it, and not a bone in `rigidExclude`), smoothed in 2 passes, limited to 4 influences and normalised.
   - A T-posed body is re-bound with its arms at 50° using dual-quaternion skinning (`crlib/rebind.py`).
   - Donor clips are sampled at 30 fps and retargeted (`crlib/retarget.py`).
3. **`assemble.mjs`** writes the GLB:
   - Joint rest equals the bind pose, and the inverse bind matrices are exact.
   - The bones listed in `rig.json` `recoil` get `hitRecoil: true` in their node extras. The runtime's hit overlay (`creatureHitOverlay.ts`) moves only those bones.
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
- Each donor drives the skeleton through its own rest frames (`Binding` in `crlib/skeleton.py`). `Bone.frame` is the bind frame and comes from the class's primary donor. Another donor gets the same rule applied to its own rest, so one class can mix donors whose rest poses and bone axes differ.
- The hips translate in one of three modes, set by the profile's `hipMode` or per clip:
  - `legs` (default): the donor's hip offset times the leg-length ratio.
  - `vertical`: only the vertical part of that offset, for serpents and bodies that must not sway.
  - `root`: the offset of the donor's highest moving bone, or of the plan's `hip_source`, for flyers whose donor bobs the root.

  Loop clips have their net horizontal travel removed.
- Leg IK works on chains of any length. For each leg, the part of the chain above the pivot joint and the part below it act as two rigid bones and are solved as two-bone IK towards the donor's scaled effector path. The solve stays in the plane the chain already bends in. Every other joint keeps its donor angle. The pivot is the donor's most bent joint. When that pivot alone cannot reach, the next most bent joint takes the rest.
- After the IK, the foot and toes pitch so the ball and the toe tip follow the donor's scaled heights. This is exact while the donor foot is in contact and otherwise only stops the foot sinking. Each pitch remembers the previous frame's angle (loops are warmed with one silent pass), so a hanging foot does not flip between two solutions, and a released contact eases back to the donor's angle. When the class records `sk.heels` (`{foot bone: heel point}`), a heel far behind the ankle is clamped at its bind height at heel strike.
- Sole contact: the lowest skinned points of each foot (vertices skinned at least 30% to the foot and toe, in the bottom band) stay on or above the floor. A foot that dips (a heel at heel strike, a toe at toe-off) rises rigidly: its IK goal is lifted by a bracketed search until the lowest sole point is on the floor, with the foot's orientation kept. `rig.json` records the largest lift per clip as `soleLift`.
- Some donors translate their hip joints, for example the animal-pack Wolf Run moves its hind hips by 35% of a bone length. These can ask for more reach than rigid bones have. `rig.json` records the worst miss per clip as `ikMiss`, a share of the leg length.
- Chains with no donor twin are driven by a damped Verlet spring chain. These are capes (back sheets, plus their part above the hips that stands off the body), front flaps between the legs, and tails. The leg and torso capsules and the floor are colliders. The columns of one sheet are linked so the sheet cannot tear. Loops run for 3 cycles, and the leftover difference is spread over the cycle.
- Lying clips (the hips drop below half their height) lift the hips by a smooth envelope of the floor penetration. No clip snaps to the floor per frame.
- Takes that are authored to chain play as one clip, for example `["Melee_Hook", "Melee_Hook_Rec"]`. A take named `<take>@mirror` is the take mirrored left to right.
- A clip spec can also set:
  - `speed`: a time-scale on the baked clip (0.8 plays the same frames over 1.25 times the duration). Heavy bodies use it for a slower Walk and Run.
  - `hipMotion`: a scale on this clip's hip translation, on top of the profile's `hipMotion`.
  - `hover`: `true` adds the donor's rest clearance above its ground (its lowest joint at rest) times the size ratio to the hips height; a number adds that many metres. The profile can set it for every clip. The clearance fades with the donor's hips height over its rest height, so a Death whose donor falls lands on the floor.
  - `chains`: `{bone prefix: {gravity, stiffness, damping, ease}}` retunes the spring chains whose first bone starts with the prefix for this clip only; `ease: [start, end]` blends from the chain's base values over those clip fractions (a dragon's wings hold their shape, then go limp and lie down in its Death).
  - `layers`: `[{"donor", "clip", "bones": [...], "kinds": [...]}]`. The listed bones, or the bones of the listed kinds, take their rotations from another donor's take in the same clip (wings from a flyer on a body from a walker). A loop repeats the layer a whole number of times so its seam closes; a one-shot plays it in real time.

## Writing a class

A class is two files: `py/classes/<class>.py` and `py/classes/<class>.donors.json`. `rig.py` imports the module by the asset config's `class`, so adding a class edits no shared file.

### The module

| Function | Required | Contract |
|---|---|---|
| `fit(body, donor, profile, source=None)` | yes | Returns `(Skeleton, notes)`. `donor` is the primary donor. Add bones with `sk.add(name, parent, head, tail, donor=, follow=, kind=)` in parent-first order. The first bone is the root. `kind` is one of `root`, `body`, `leg`, `arm`, `tail`, `cloth` or `wing`. `donor` names the primary donor's bone; `None` means the bone follows its parent (and a spring chain if `plan` lists it). `notes` is any JSON and ends up in `rig.json` as `fit`. |
| `plan(sk, body, profile)` | yes | Returns `{"hips": <bone>, "legs": [...], "chains": [...], "colliders": [...], "hip_motion": <float>}`. It can also set `hip_mode` (`legs`, `vertical` or `root`), `hip_source` (a donor bone for `root` mode), `scale` (a fixed size ratio instead of the leg-length one) and `hover`. |
| `cloth(body, sk, profile, heat)` | no | Adds sheet chains (`heat=False` bones) and returns `override(W) -> (W, locked)` for the skin step. |
| `bind_turns(sk, profile)` | no | Returns `{bone: rotation}`. It re-poses a bind that sits far from the donor's working range, for example spread wings or T-pose arms. |
| `donor_map(sk, donor, profile)` | no | Returns `{primary donor bone or target bone: this donor's bone or None}` for a secondary donor. It is called once per donor; return `None` to use the donor spec's `map`. |
| `closeup_joints(sk, profile)` | no | Returns the joints the review close-ups frame. |
| `recoil_bones(sk, plan, profile)` | no | Returns the bones the runtime's Hit recoil may move. Without it, the profile's `recoilBones`, else every deforming bone except the root, the hips, legs, cloth springs and chains lying on the floor (a crawler's planted body). |

Every donor spec a class loads gets `_work` (the asset's work folder), so a generated donor such as an authored pack finds the mesh under any `--out` folder; use it rather than deriving the folder from the donor cache.

`fit()` can also leave these on the skeleton: `sk.heels` (`{foot bone: heel point}`, for the heel clamp) and `sk.rigid_exclude` (bones the loose-piece rule never binds a piece to; the profile's `rigidExclude` adds more). Upright classes should take their head, foot and hand tips from `crlib.landmarks.biped_tips(body, legs)`; `humanoid.py` and, through it, `golem.py` do.

A leg in `plan()["legs"]` is `{"chain": [bone, ...], "foot": bone or None, "toe": bone or None, "pivot": index or None}`:

- `chain` holds the segments the IK bends, from hip to ankle.
- The effector is the head of `foot`. With no foot it is the tail of the last chain bone, for example a spider's leg tip.
- `toe` enables ball and toe contact. It needs a `foot`.
- `pivot` forces the pivot joint: an index into the chain's joints, where 1 is the first knee.
- `scale` multiplies the size ratio for this chain's effector path, for example a neck solved like a leg that must not bury the beak.
- The tuple `(upper, lower, foot[, toe])` is still accepted and means a two-bone chain. `humanoid.py` uses it.

A spring chain in `chains` is `{"bones": [...], "stiffness", "damping", "gravity", "hang", "clearance", "group"}`, with the colliders `CapsuleCollider(sk, bone, radius)` from `crlib.retarget`. Legs whose bones have no twin in a clip's donor lose IK for that clip; `rig.json` lists them under `fit.donorGaps`.

### Source rigs

`source` is `None`, `{"kind": "fitted"}`, or `{"kind": "tripo-rig", "file", "joints": [{name, parent, position, weightShare}]}` with positions in the production mesh's space. For a generic `bone_N` rig, `source["labels"]` comes from `crlib/labels.py` and has these fields:

| Field | Contents |
|---|---|
| `legs` | `[{side, order, chain, attach, tip}]`. `side` is `l` (+X, the creature's left) or `r`, and `order` is 0 at the front. |
| `spine` | Pelvis to chest. |
| `neck` | The joints between the chest and the head. |
| `head` | The head joint. |
| `headTip` | The tip beyond the head. |
| `jaw` | The jaw chain, if any. |
| `headExtras` | Other head chains, such as horns and ears. |
| `tail` | The tail, or a spider's abdomen. |
| `limbs` | `[{side, kind: "wing" or "arm", chain, attach, leaves}]` |
| `legHubs` | Bones off the axis that only carry legs. |
| `root` | A root lying on the ground under the body. |
| `other` | Everything else. |

To check a download, run:

```sh
py -3.13 tools/creature-rig/py/crlib/labels.py <rig.glb> --png out.png
```

It prints the labels and where the `neutral_bone` weight would go. The PNG shows the labelled tree over the mesh, with the mesh on `neutral_bone` in red. `reassign_neutral()` moves that weight to the nearest bone, for a class that reuses source weights.

Verified results:

| Rig | Labels | Gaps |
|---|---|---|
| Red dragon d20f1d55 | 4 legs, tail, spine, neck, head, and the left wing | Tripo rigged only the left wing. The skull and tail tip sit on `neutral_bone` (30%). |
| Arachnid 0ea08166 | 6 legs, the abdomen as `tail`, and the leg hub as `head` | One right pedipalp (`arm`). The abdomen shell is on `neutral_bone` (8%). |

### The donor map

`<class>.donors.json` has three keys:

- `donors`: `{key: spec}`.
- `primary`: the donor that names the bones and sets the bind frames.
- `profiles`: `{name: {clips: {State: {donor, clip, loop?, ik?, in_place?, hipMode?}}, hipMode?, hipMotion?, legs?, ...}}`.

`clip` is a take name or a list of takes that chain. A clip spec's other keys are in [Retarget rules](#retarget-rules): `loop`, `ik`, `in_place`, `hipMode`, `speed`, `hipMotion`, `hover` and `layers`.

A donor spec is one of the following. Common options are `yaw` (degrees about +Y, so the donor faces +Z), `armature`, `map`, `source` (credit text) and `subTakes`. `subTakes` (`{"PeckDown": {"take": "Eat", "range": [1, 20]}}`) adds named slices of another take's file, in that file's own frames, so a `ref` to a catalog entry can cut a take without naming file paths.

| Spec | Meaning |
|---|---|
| `{"ref": "<catalog key>", ...overrides}` | An entry of the shared catalog `py/donors.json`. Prefer this. |
| `{"file": ...}`, `{"files": [...]}` | One GLB, FBX or `.blend` file; the takes are its actions. `"ranges": {take: [first, last]}` slices them. |
| `{"zip": ..., "member": ...}`, `{"unitypackage": ..., "member": "Assets/..."}` | The same, extracted into `test-results/creature-motion/rig/donors/`. |
| `{"rig": <file spec>, "takes": {"Walk": {"file": <file spec>, "range": [first, last], "action": ...}}}` | One take per file, or per range of a shared timeline. |
| `{"pack": "animalpack", "name": "Wolf"}` | janpec Animal pack deluxe: the rig plus every `<Name>_<Take>` file, sliced by the Unity ranges in `clip-ranges.json`. This handles the `_exp` rigs. |
| `{"pack": "unity", "package": <.unitypackage, extracted dir, or a list of them>, "rig": "Assets/…", "takes": "Assets/…/*.fbx"}` | A take per FBX. |

Ranges are in the source file's own frames. Every take is resampled to 30 fps whatever the file's rate: Quaternius files are 24 fps. Donors whose importer keeps node axes (Maya and Max FBX: bones along X) are re-aligned so each rest frame's Y axis points at the bone's child. The same constant turn is applied to every sampled frame, and the donor report shows it as `realigned`.

### Checking donors

Run `donor_check.py` before writing a profile:

```sh
py -3.13 tools/creature-rig/py/donor_check.py <catalog key> [--tree]
py -3.13 tools/creature-rig/py/donor_check.py --catalog
py -3.13 tools/creature-rig/py/donor_check.py --class <class>
```

For each donor it prints:

- file, source fps and bone count
- whether the axes were re-aligned
- the facing estimates (`rootToHead` and `toes` should be about `[0, 0, 1]`; otherwise set `yaw`)
- per take: frames, seconds, source range, hub travel and height range, and `rest delta` (how far a take file's own skeleton is from the rig's)
- the bone tree, with `--tree`

### The catalog

`py/donors.json` holds every donor below; all load and face +Z.

| Keys | Source | Notes |
|---|---|---|
| `animal_{bear,cattle,chicken,crocodile,deer,firesalamander,goat,ibex,scorpion,viper,wildboar,wildrabbit,wolf}` | Animal pack deluxe, per-take FBX | Takes: `Idle`, `Walk`, `Run`, `Attack`, `Die`, `Eat`, … (Crocodile `Bite`, Wolf `IdleA/B/C`, `Howl`) |
| `animal_{butterfly,common_frog,crab,iron_age_pig,octopus,rat,snail,swan_goose}` | Animal pack deluxe `_exp` rigs | Unity ranges on a shared timeline; bones are `Bone001…` |
| `quat_enemy_{spider,wasp,snake,frog,rat}` | Quaternius Easy Enemy | `wasp` has `yaw: -90` |
| `quat_farm_{cow,horse,zebra}` | Quaternius Farm Animals | |
| `quat_monster_{dragon,bat,skeleton}` | Quaternius Monster pack | Flight takes |
| `dm_{souleater,terrorbringer,usurper,nightmare}` | Dungeon Mason Four Evil Dragons | From the main checkout's extracted copy, else the Unity package. NightMare has no mesh file, so its rig is `idle01.fbx`. |
| `dm_dragonboar` | Dungeon Mason Soul Eater and Dragon Boar | Unity package |
| `pixelius_01` … `pixelius_06` | PixeliusVita `MonsterNN_AllAnim.fbx` | Unity packages; 01 has `_InPlace` takes |
| `pixelius_07` … `pixelius_09` | PixeliusVita, from the production GLBs | The source ships `.anim` files; `monsters-build.ts` already converted them to native takes |

The Dungeon Mason files are in centimetres. The ratios are scale-free, so only the numbers look large.

### Existing classes

| Class | Profile | Donor | Idle | Walk | Run | Attack | Hit | Death |
|---|---|---|---|---|---|---|---|---|
| humanoid | knight | UAL1 | Idle_Loop | Walk_Loop | Jog_Fwd_Loop | Sword_Attack | Hit_Chest | Death01 |
| humanoid | brute | UAL1 + UAL2 | Idle_Loop | Walk_Loop | Jog_Fwd_Loop | Melee_Hook + Melee_Hook_Rec | Hit_Chest | Death01 |
| humanoid | spirit (`legs: false`) | UAL1 | Idle_Loop | Walk_Loop | (none; falls back to Walk) | Spell_Simple_Enter + Shoot + Exit | Hit_Chest | Death01 |
| humanoid | guard, bandit, undead, ogre, caster, beast, fae | UAL1 + UAL2 | see `humanoid.donors.json` | | | | | |
| golem | golem | UAL1 + UAL2 | Idle_Loop | Zombie_Walk_Fwd_Loop | (none) | Zombie_Scratch | Hit_Chest | Death01 |
| golem | golemPunch | UAL1 + UAL2 | Idle_Loop | Zombie_Walk_Fwd_Loop | (none) | Punch_Cross | Hit_Chest | Death01 |
| golem | treant | UAL1 + UAL2 | Idle_Loop | Walk_Loop | (none) | Melee_Hook + Melee_Hook_Rec | Hit_Chest | Death01 |
| bird | fowl, wader | Animal pack Chicken | Idle | Walk | Run | Eat 1–20 + 214–230 (peck) | (none; runtime fallback) | Die |
| winged | wasp, fae | Quaternius wasp | Wasp_Flying | Wasp_Flying | Wasp_Flying | Wasp_Attack | (none; runtime fallback) | Wasp_Death |

The quadruped, arthropod, serpent, rooted and special_* classes (snail, star, reliquary, treant, quad, with authored takes in `authored.py`) list their profiles in their own `.donors.json` files.

The spirit profile has no leg bones. A 3-bone tail chain runs from the waist to the lowest tip. The golem class reuses the humanoid fit and adds quiet torso bones, sole joints, a heel pivot, foot blocks and rigid plates. The bird class solves the neck like a leg towards the chicken's head path. The winged class (on its own branch until merged) fits span chains for the wings.

## Studio mode

An asset config with a `studio` block keeps the production file's own rig, skin and native clips and only adds retargeted clips. `run.mjs` then skips the intake, runs `py/studio.py` for the rig step, and `studio.mjs` for assemble and review. The review stage hashes every kept clip (sampler bytes, targets and interpolation) against production and fails if a native clip changed.

| Key | Meaning |
|---|---|
| `map` | `{studio node name: {bone, donor?, follow?, kind?, parent?, tail?, noTail?, noKey?, translate?}}`. `bone` is the class's bone name (UE names for humanoids). `parent` names a logical parent when the node's own parent is not on the limb (IK-baked feet); such nodes also get translation keys. |
| `rootNode` | The studio node under which the root sits on the floor |
| `hips` | The class bone that carries the hips translation (default `pelvis`) |
| `legs` | Optional leg chains in class bone names, as a plan's legs (`{chain, foot, toe, pivot?}`). Without it, every chain of bones mapped with `kind: "leg"` becomes a leg: followed down from its first leg bone while it has one leg child, four or more bones end in a foot and a toe (ball contact), three in a foot, two drive the tail of the last bone. Each leg gets the retargeter's IK towards the donor's scaled effector path, so a body driven forward over planted feet does not slide them, on any skeleton |
| `referenceClip` | Optional native clip whose first frame is the rest the donor is matched to |
| `replace` | Native clips dropped before the new ones are added |
| `clips` | Clip specs as in a profile, plus `layer` (`{clip, bones, donor?, rate?, hold?, release?}`: an arm pose held from another take), `flatProp` (`{hand, node, from, to?}`: a long prop turned level, or upright with `to: "up"`), `gripRelease` (`[start, end]` fractions over which the grip lets go) and `lift` (lift the hips out of the floor while lying). Without `clips`, the class profile's clips are used. |
| `grip` | `{hand node: native clip}`: the hand keeps its local rotation from that clip's first frame |
| `hipMotion` | The body's hip motion; a clip's `hipMotion` replaces it |
| `propPoseClip` | A native clip whose keys pose props under joints (a bow string) in the new clips |

The Quaternius Universal Animation Library (CC0) is extracted from `C:/Users/Borg/Documents/GitHub/Corealm/.asset-cache` into the work area. Donor files are never copied into the repo.

## Known limits

- A robe or skirt over the legs can be misread as cape panels. Golem and treant profiles turn the cape finder off; a body modelled turned (the gloamgarden sporekin, about 30°) needs the profile `yaw` fit first.
- When the fit misreads anatomy (fused robes, floor-length arms, antennae), give tips and joints in the asset config under `profileOverrides.landmarks {tips, joints}`.
- Floor-length arms still lack a knuckle-walking donor: the starroot guardian keeps its previous production rig until one exists.

- Joint placement uses measured features. Unusual anatomy can still misplace a joint, so check `fit.png` for every new asset. A floating body's waist uses the biped ratio between the shoulders and the hand tips.
- The shoulders and armpits of a T-posed body are re-bound to 50° with dual quaternions. Extreme overhead poses still pinch.
- Cloth is a spring chain, not a cloth solver. Wide capes get 2 linked columns. Stretch percentiles on very fast clips (Run, the Sword_Attack spin) are dominated by the cape.
- The Sword_Attack and Death01 clips travel. That travel is kept, and in-place removal applies only to loops.
- No-root-motion clips report ground speed in `validation.json`. The runtime move speed should match it; the root owns that table.
- Donor bone translation is not reproduced: only the hips translate. Stretchy donors (animal-pack runs, ARP `*_stretch` bones) lose that stretch, and the IK reports it as `ikMiss`.
