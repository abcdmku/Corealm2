# Animal asset pipeline

Turns the **Animal pack deluxe** Unity package into the GLBs and audio Corealm ships.

Everything here is re-runnable from the original `.unitypackage`. Nothing in `.asset-cache/` is
committed, exactly like the Quaternius zips `tools/build-assets.ts` reads.

## Licence, and why it matters here

The other packs in `game/public/assets/` are CC0. **This one is not.** Animal pack deluxe is a paid
Unity Asset Store product by *janpec*, used under the Unity Asset Store EULA, and the manifest
records that in its `packs` entry rather than claiming a licence it does not have.

The EULA covers use in a game. It does not permit redistributing the assets in a form that lets
someone else extract and reuse them, and a browser game serves its GLBs as plain files over HTTP,
so anyone can download `models/animal/animal_bear.glb`. That is a real consideration before a
public deployment and it is a licensing question, not a technical one. The audio is unaffected:
every clip in `game/public/audio/sfx/animals/` is CC0 and ledgered in
`docs/audio-source-animals.md`.

## Prepare the source

The package lives in the Unity Asset Store download cache:

```
%APPDATA%\Unity\Asset Store-5.x\janpec\3D ModelsCharactersAnimals\Animal pack deluxe.unitypackage
```

A `.unitypackage` is a gzipped tar in which each asset is a GUID directory holding `asset`,
`asset.meta` and `pathname`. Extract it by reconstructing the real tree from those `pathname`
files, then stage what the build needs:

```bash
# 1. extract to a scratch directory (one-off, ~850 MB)
#    each <guid>/asset is written to the path named in <guid>/pathname
# 2. copy the rigs and clips
cp "<extracted>/Assets/Animal pack deluxe/Models/"*.fbx      .asset-cache/animal-pack/models/
cp "<extracted>/Assets/Animal pack deluxe/Animations/"*.fbx  .asset-cache/animal-pack/anims/
# 3. stage base-colour textures (see the warning in the script about the alpha channel)
python tools/animals/stage-textures.py
# 4. stage the animation clip frame ranges out of the package's Unity .meta sidecars
python tools/animals/stage-clip-ranges.py
```

Step 4 is not optional. Half the animation files are not single clips: the `_exp` rigs pack every
motion into ONE take and the individual motions are sub-ranges of it, so without the ranges the
frog, hog, rat and crab each ship four identical clips and never appear to change animation.

## Build

```bash
npx tsx tools/build-animals.ts                    # all 22, updates manifest.json
npx tsx tools/build-animals.ts --only animal_bear # one, still updates the manifest
npx tsx tools/build-animals.ts --keep-raw         # keep the pre-optimization GLB
```

Conversion runs in headless Chromium (`convert.html` + `convert.js`) because three's `FBXLoader`
and `GLTFExporter` both need DOM APIs Node does not have. Playwright is already a dependency.

Outputs go to `game/public/assets/models/animal/`, and entries are merged into
`game/public/assets/manifest.json` plus a durable copy in `tools/data/animal-assets.json`.

## Native motion on the shipped bodies

The shipped bodies carry reviewed textures, polished skins and rig additions that a full rebuild
would lose, and their meshes, skins and rest poses never changed after the first import. So their
motion is restored by splicing, not reconverting:

```bash
npx tsx tools/animals/splice-native.ts                      # every pack body
npx tsx tools/animals/splice-native.ts --only animal_deer    # a subset
npx tsx tools/animals/splice-native.ts --only animal_rabbit --out test-results/try   --try "Eat=WildRabbit_Eat.fbx"                            # preview another take as a clip
```

It reads each take straight from the extracted pack (`ANIMAL_PACK_DIR`, Unity ranges from
`ANIMAL_PACK_RANGES`), binds tracks to production nodes by FBX identity, pins root XZ (root Y
stays), appends at most one closing key to an open loop, and resamples at the 1e-4 default. It
writes candidates and a `catalog.json` under `test-results/creature-motion/animals/`; production
is never written. The take table (`BODIES`) is the record of which native take plays each state.
States the pack lacks are omitted. Where a body has no attack of its own, `retarget-native.ts`
retargets a same-template take rest-relative (world-space rotation deltas, no bone length change).

## Audio

```bash
python tools/animals/stage-audio.py    # downloads must already be in .asset-cache/animal-audio/
```

Sources, CC0 evidence, the rejected material and the selection caveats are in
`docs/audio-source-animals.md`. Requires `ffmpeg` for the mp3/wav sources.

## Check the result

```bash
npx tsx tools/animals/probe-all.mjs                  # measure every source rig, before converting
npx tsx tools/animals/inspect.ts <glb> --dump        # material, normals, and the embedded texture
npx tsx tools/animals/levels.ts                      # derived combat level for every stat block
npx tsx tools/animals/verify.ts --shots              # boot the real game, read state, screenshot
npx tsx tools/animals/clip-durations.ts             # every clip's length, per animal
node tools/animals/pose-shots.mjs animal_deer       # render Idle and Attack at four phases
npx tsx tools/animals/fight-probe.ts <entityId>     # which clips actually play through a fight
npx tsx tools/animals/far-probe.ts                  # drawn size on the rigged AND instanced paths
```

`pose-shots.mjs` is how an attack gets judged. Keyframe counts cannot tell you that a deer is
grazing instead of butting; four rendered phases with a camera locked to the rest pose can.

`verify.ts` is the one that matters, because AGENTS.md rule 7 says source review is not gameplay
proof. It reports each group's spawned count and health out of `__gameDebug`, and prints the drawn
height and the live animation path per group, which is the only way to tell a rig playing `Idle`
from an instanced copy frozen on a baked frame.

## Traps this pipeline already fell into

**The alpha channel is not transparency.** These are Unity legacy `_col_unity` maps: RGB is albedo
and alpha is a specular/gloss mask. Keeping it costs nothing until `textureCompress` turns the PNG
into a JPEG, at which point sharp flattens onto black first — mean alpha of 67/255 multiplied every
animal's albedo by about 0.26 and they all shipped as silhouettes. `stage-textures.py` drops alpha.

**The pack has no attack animation for ten of these animals.** Substituting the nearest authored
motion is what the converter did first and it is simply wrong: a deer and a chicken "attacked" by
lowering their heads and feeding at the ground, and the frog attacked by hopping a metre and a half
away. `synthesiseAttack` in `convert.js` authors a real strike instead - the body keeps a slice of
its own idle, the root bone lunges forward along +Z and pitches down into the blow, then recovers.
Tuned per animal by `synthAttack` in `catalog.mjs`.

**Root motion has to be stripped by BONE, not by name.** The named rigs call their root
`*_MAINSHJnt`; every `_exp` rig calls it `Bone001` or `Bone002`. A name regex covered the first
group and missed the second, so the frog kept the 134.7 units of travel baked into its hop and
physically leapt 1.35 m on every step and every swing.

**A clip file is not always a clip.** `crab_idle_anim.FBX` is a 200-frame take whose idle is frames
110 to 111 - one held pose, degenerate enough that gltf-transform drops the animation outright and
the crab ships with no `Idle` at all. Ranges that tight get widened in `catalog.mjs`. The same
mechanism is what turns a 230-frame chicken feeding loop into a 38-frame peck.

**A file is not always ONE take, either.** This pack's files each hold a single take, so the
converter's historical `animations[0]` read is right here — but a pack can ship many named
AnimStacks in one FBX (the miniboss rig carries eleven). A clip entry may therefore carry a `take`
naming the AnimStack it wants, and several clips may pull different takes from the same file. A
named take missing from the file fails that clip loudly instead of falling back to `animations[0]`:
the wrong take still animates, so a silent fallback is a defect that plays convincingly.

**The run cycle was shipped as the walk cycle, for every animal.** The catalog mapped `_Run` to
`"Walk"` across the pack, on the reasoning that enemies only ever moved while pursuing, so the run
was the honest gait for the only speed that existed. That reasoning aged out — creatures potter
about now, and pursuit speeds come from each animal's own gait — but the real cost was there all
along: a gallop is a gallop at any playback rate. Every creature in the game walked with a running
gait, and because the only lever left was retiming, the roster was tuned to three and four leg
cycles a second and reported three times as "feet move rapidly and they are jittery". Both clips are
built now, `render/entityViews.ts` picks between them by whether the creature is pursuing, and each
is retimed against its OWN measured stride. The chicken is the illustration: its walk is 1.03 s
implying 0.22 m/s, its run 0.57 s implying 0.75 — different animations, not one at two speeds.

**The tier tint eats real textures.** `render/entityViews.ts` pulls enemy materials 45% toward the
tier's metal swatch, which is Kaldite blue-black at tier 10. That was right when the bestiary was
four stylized meshes sharing a grey texture and wrong for photographic hide. Materials named
`animal_*` are exempted there via `ANIMAL_MATERIAL`; the name is a contract between that file and
`build-animals.ts`.
