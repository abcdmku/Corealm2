# Tripo creature imports

Run `npx tsx tools/tripo-creatures/import.ts tools/tripo-creatures/first-batch.json`.
The importer copies the exact downloaded GLBs into `assets/art/tripo/imports/creatures/sources/`
and records SHA-256 hashes, original texture dimensions, joint names, material maps and clips.
It never edits Downloads or production assets.

The initial batch exports were static. Individual exports supplied 8K base color and
inverse bind matrices, but omitted the joints' rest transforms and assigned nearly every
vertex to one joint. Their geometry was also rotated 90 degrees relative to their bind
matrices. These problems are recorded separately from source-image approval.

Grove Brute and Undercrag Mawer now have staged candidates. The geometry basis is restored
only after a closest-point comparison against the original static export proves the
rotation. Both match within three micrometers. The tool reconstructs local rest transforms
from the exported inverse binds and rebuilds four-influence weights against those actual
anatomical bone segments. This weight repair was authorized by the root; it still requires
visual review. All original source bytes remain unchanged.

`retarget.ts` maps the native humanoid motion library to the recovered Mixamo hierarchy,
aligns limb rest directions, scales pelvis displacement by leg length, and samples mesh
grounding. There is one Hit; directional hit generation and review are retired.
Flint Mandible's eight-joint export assigns every vertex to bone_0 and has no articulated
six-leg rig. It remains excluded from candidate assets.

The importer requires usable Idle, Walk, Run, Attack, Hit and Death clips before emitting
candidate assets. `clipAliases` can rename real source takes. Source motion and repair
provenance is stored with each candidate.
Runtime copies keep all material channels and downsample textures to a 2048-pixel maximum;
the source GLBs preserve the original maps. No topology changes occur.

The catalog uses `tools/lib/assetCandidates.ts` and the existing production asset IDs.
The root owns the devdocs six-state review, manifest integration and build.
Import checks do not establish visual acceptance.

## Family repair passes

Family profiles implement `repairProfile.ts`. Stage a family with
`npx tsx tools/tripo-creatures/repair.ts --family=winged`; use `--only=id,id` for a smaller
pass. Outputs live under `test-results/creature-audit/candidates/<family>/`. Sources and
motion donors are pinned to Git blobs and SHA-256 hashes so rebuilding does not retarget
an already repaired output. Candidate filenames contain content hashes and the catalog
updates atomically. Unchanged good bodies retain their original bytes.

Retargeting transfers native studio motion through explicit anatomical mappings, donor
world rotations and animated limb directions. Targets retain their segment lengths;
unsupported target scale or shear fails before mutation. Full pose tracks prevent previous
states leaking into Idle or Death. Source stretch is handled without copying it into the
target skeleton. Rig placement and weights need separate anatomical repair where malformed.

Validation checks channels, transforms, bindings, weights, deformation and motion coverage,
including cubic interpolation extrema. Numerical validity still requires visual review.
Compare good original studio takes through the same devdocs stage and phase controls.
Inspect contact, held endpoints and recovery; record verdicts against the exact candidate
bytes. Only the root promotes accepted GLBs, manifest and runtime motion timing together,
then commits the family. A staged catalog is never automatically promotable.
