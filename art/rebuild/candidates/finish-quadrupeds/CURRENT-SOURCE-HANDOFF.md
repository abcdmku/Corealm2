# Quadruped source adaptation checkpoint

GPU is released. No public assets are promoted. Root owns acceptance and shared integration.

## Frozen review batches

| Catalogue | Contents | State |
| --- | --- | --- |
| `source-geometry-comparison/catalogue.json` | Refined Fox, provisional-rights Badger v1, Monitor revision8 | Twelve D3D11 views completed and inspected. Root accepted Monitor static direction; natural lifecycle remains pending. Fox paws and Badger material required repair. |
| `source-new-bases-comparison/catalogue.json` | Corrected-material provisional Badger, original CC0 Horse, p0ss Sheep2 CC-BY-SA3 | Ready for four geometry views each. All exports static. Sheep is a source base, not finished Bighorn. |
| `fox-reach-comparison/catalogue.json` | Complete source Fox with reshaped paws and revised locomotion | Ready for geometry/Walk/Run scrutiny. Sub-mm position/contact measurements do not establish the later contact-velocity gate. Further derivative work is separate. |
| `fox-adaptive-comparison/catalogue.json` | Latest complete Fox actor, eight distinct roles | Ready for static and natural lifecycle proof. SHA `07771d082ff31a4a0403fa4c4c3ddbf77c95db5066bf964d8befe8fdff751518`, 2,280,448 bytes. Actual contact maximum 8.540 mm/s across 4,929 sampled poses; generic Survey-to-Run blend burial 13.064 mm remains measured and requires production visual judgment. |
| `complete-mammal-adaptations-comparison/catalogue.json` | Cat-derived Lynx, CC0 Rat-derived Porcupine, CC0 Rat-derived Badger | Ready for source-derived anatomy review. Existing source locomotion still penetrates the floor; no contact acceptance. This Badger uses none of the provisional-rights source. |

Every batch copies its GLBs and records exact source-catalogue and candidate hashes in `origins`. The helper rejects stale filename/hash mappings before copying. Later child work must use separate filenames/catalogues so these review bytes remain stable.

## Candidate limitations

The newer Lynx actor `fcc4296906bfeec04b9b2c650639a150238d2bccf14b2ec45b427ade1453b2d5` is held separately from the frozen anatomy batch. An independent unlabelled physical-contact audit found Walk/Run residual maxima of 3.372/9.289 m/s near support release; the earlier labelled p95 view understated this. Generic Idle-to-Walk/Run blends also bury vertices by 139/157 mm. The owner is repairing support release and anatomical bind pivots. Do not cite this actor as contact-ready.

Porcupine original-rig continuous IK v2 preserves bone lengths, torso matrices and approximately 19.375% Run flight while eliminating sampled whole-mesh burial. It still slides at actual near-floor toe contacts, with 2.138/3.354 m/s Walk/Run residual maxima. Support constraints and smooth recovery lift remain in progress; frozen anatomy bytes are unchanged.

Source-derived Bighorn v3 and Moose v2 have CPU stills and separate static catalogues. Bighorn source motion is contact-rejected; Moose has no actions and unresolved native Bone.005 mapping. These are anatomy candidates only. Tapir whole-source head/ear/toe revision is being checked in CPU stills. Root schedules production hardware review.

- Fox reach GLB `2907e9bd1965ee15a9b9cf9c436e56aa542fd0f5f24f1446ddb94279b5b870e8` retains complete source body and reshapes connected distal mesh into paws. New Run is 0.55 s and measured around 1.8 m/s; pelvis lowering reduced from 145 mm to 20 mm. A later velocity audit found boundary slip, so planting remains unaccepted. Separate genuine attack, reactions and settled death are authored and being combined with a corrected derivative. Queued bytes remain unchanged.
- Lynx GLB `556f17e082d94c0b2bc64872eefc5d6e655ec9ee0bb61507d1754f44271c414e` adapts the complete Cat body, with shortened tail, connected ruff, ears, paws and dapple coat. Baked standard four-weight conversion has random RMS 0.444 mm, p99 2.036 mm and max 9.047 mm position differences against full-source evaluation. Largest normal differences are on a limb, about 21 degrees. These are deformation errors, not ground-contact measurements. Native-derived Walk/Run sole dips remain. Calm Idle and contact-corrected actor output are separate ongoing work.
- Porcupine GLB `3cbfb186bc81e5a6d3070eb032b9e8937f2dedff42de1debd54ba09433a29cf3` uses the complete verified CC0 Rat base, 970 attached quills and 13 real source-derived clips. Dense source-foot audit reports up to 29 mm Walk and 20 mm Run penetration plus significant stance drift. A per-frame whole-body lift is not part of the frozen candidate. Per-limb repair is separate.
- CC0 Badger GLB `7e2b87920ac035d6a9886ad3c35a050fee7e6097fd5a1bb75e76702e2bd59bf0` preserves complete Rat topology, UVs and weights with authored body/head/paw/tail/coat changes. Thirteen source-derived clips remain; sampled Walk/Run/Die penetration is approximately 52/17/60 mm. Inspect mouth closure and species readability first.
- The original Rat has 14 actions. Its optional long Idle.000 contains six source B-bone discontinuities, with measured 33–51 mm jumps in Blender. The source archive and rejected artifact remain. The corrected release contains the other 13 real actions, including Idle.001 and Idle.002, without aliases.

## Licenses and remaining sources

Horse is CC0 by Lyndon Daniels, with ChadM's rigged derivative also released as CC0. Its complete static body is useful, but the native armature has no actions and lacks Bone.005 despite 330 body vertices dominated by that group. Mane, tail and eyes also need binding. Do not claim the source rig is ready for gameplay.

p0ss Sheep2 is CC-BY-SA3.0. Root explicitly accepted this license for adaptation with proper attribution and share-alike records. It is not the separate weaker CC0 cartoon sheep.

The Gonsplitters/mz4250 Badger remains provisional. The publisher declares CC-BY-SA4, but exact original creator grant and mesh identity are not independently verified. A real roughness conversion error was repaired by explicitly packing `1 - smoothness`; geometry and source texture pixels were preserved. No deep derivative or promotion of this source is authorized yet.

No unverified Animal Pack Deluxe entitlement is assumed. Its already shipped Boar/Deer/Ibex can be inspected read-only, but are not new derivative bases here.

## Active source ownership

- `badger_rebuild`: source-feline conversion and Lynx actor work.
- `porcupine_rebuild`: faithful original Rat conversion and Porcupine adaptation/contact.
- `lynx_rebuild`: complete Fox adaptation, authored gameplay clips and contact.
- `horse_rebuild`: separate CC0 Rat-derived Badger fallback; provisional Badger files remain frozen.
- `hoofed_integrator`: new complete CC0 Horse-derived Moose under `source-moose-horse/` and its species helper.
- `tapir_refinement`: new complete CC0 Horse-derived Tapir under `source-tapir-horse/` and its species helper.
- `bighorn`: new complete p0ss Sheep-derived Bighorn under `source-bighorn-sheep/` and its species helper.

Horse-derived and Sheep-derived work must reshape the full anatomy and natural feet, preserve measured source mappings and report original-to-adapted proportions. Earlier procedural refinements remain evidence, not accepted exports.
