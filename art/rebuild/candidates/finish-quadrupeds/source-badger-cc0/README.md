# CC0 whole-body Badger adaptation candidate

This is a Badger adaptation of CDmir and TinyWorlds' complete [Evil Giant Rat](https://opengameart.org/content/evil-giant-rat), released under CC0 1.0. It does not use the unverified Gonsplitters/mz4250 Badger mesh or textures. Original source Blender SHA256: `52530520c71787da6c9ced7130cca02ddaf2b0af567bc38221b746d2297b5be2`.

The sibling rat worker owns the verified native conversion. This adaptation calls `loadNativeRatSource()` from `tools/creature-expansion/mammals/source-porcupine.mjs`, which checks its released final-byte audit and source hashes. It does not alter sibling files or repeat source animation corrections.

`candidate-catalogue.json` maps production slot `creature_rootdelve_badger` to `cdmir-badger-normalized.glb`, SHA256 `7e2b87920ac035d6a9886ad3c35a050fee7e6097fd5a1bb75e76702e2bd59bf0`. Dimensions are approximately .434 × .35 × .877m. This is a candidate pending hardware species review, not an accepted replacement.

The existing body, head, articulated limbs, paws, tail, eyes and teeth are reshaped together. The original 5,930-triangle topology and source UVs/weights are retained. The continuous body warp lowers the rat arch, broadens the shoulders and paws, compresses the original tail chain, reduces the ears and closes the resting jaw. New gray body fur colors, dark feet/chest and a pale striped face are position-baked into the original UVs. Existing source normal maps are removed and surface normals recomputed after the reshape. No capsule body, head graft, external Badger geometry or borrowed coat is present.

References: [RSPCA Badgers](https://science.rspca.org.uk/en/web/rspca/adviceandwelfare/wildlife/badgers) describes muscular short limbs, broad feet, strong claws, gray body fur and black legs/chest; [British Wildlife Centre](https://britishwildlifecentre.co.uk/planyourvisit/animals/badger/) describes coarse gray fur and dark legs. These inform authored proportions and colors, not measured morphology.

All 13 released native clips retain their names, timing, rotation and scale keys. Ordinary joint pivots and translation tracks follow the spatial warp. Per-vertex corrective translations are recomputed using `warp(R*p+t)-R*warp(p)`. Original `Idle.000` remains in the source Blender file but is excluded from the released native conversion because of original B-bone discontinuities. Use `Idle.001` for candidate static/idle review.

Reproduce:

```powershell
node art/rebuild/candidates/finish-quadrupeds/source-badger-cc0/adapt-rat-badger.mjs
node art/rebuild/candidates/finish-quadrupeds/source-porcupine/inspect-exported-motion.mjs ../source-badger-cc0/cdmir-badger-normalized.glb
node art/rebuild/candidates/finish-quadrupeds/source-badger-cc0/audit-badger-contract.mjs
```

CPU checks verified unchanged source topology, UVs and weights, intact native clip timing/rotations/scales, no zero-area adapted triangles, and finite skinned geometry at 410 final-byte motion samples. Body triangles have no normal-direction reversals. Sixteen head triangles around the closed jaw turn more than 90 degrees compared with the source; the mouth needs close hardware review. The source's actual digit topology is retained, so anatomical five-toe Badger paws are not yet certified.

Foot-contact limits are explicit: sampled Walk reaches −52.4mm, Run −16.7mm and Die −60.1mm below the rest floor. Idle001/002 remain grounded in those samples. This candidate needs a static whole-body/face/tail acceptance decision before further motion/contact polish. No GPU, browser, combined gate or public integration was performed by this worker.
