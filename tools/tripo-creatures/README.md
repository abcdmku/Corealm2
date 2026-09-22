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
grounding. HitLeft and HitRight are explicit aliases of the genuine frontal hit take.
Flint Mandible's eight-joint export assigns every vertex to bone_0 and has no articulated
six-leg rig. It remains excluded from candidate assets.

The importer requires usable Idle, Walk, Run, Attack, Hit and Death clips before emitting
candidate assets. `clipAliases` can rename real source takes. Source motion and repair
provenance is stored with each candidate.
Runtime copies keep all material channels and downsample textures to a 2048-pixel maximum;
the source GLBs preserve the original maps. No topology changes occur.

The catalog uses `tools/lib/assetCandidates.ts` and the existing production asset IDs.
The root owns the feature-lab walk/run/attack/hit/death review, manifest integration and
build. `readyForLab` means the file passed import checks, not visual acceptance.
