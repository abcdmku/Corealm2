# Fox source geometry and motion review candidates

The original source, `Fox.adapted.glb`, and original `catalogue.json` remain frozen. Nothing here is production accepted. Combat, directional hits and death remain absent.

- `Fox.adapted-motion.glb` + `motion-catalogue.json`: first frozen geometry with derivative contact motion.
- `Fox.paws.glb` + `paw-catalogue.json`: connected source paw reshaping, original native animations retained.
- `Fox.paws-motion.glb` + `paw-motion-catalogue.json`: paw reshaping plus derivative contact motion. This is the newest review candidate.

Paw shaping alters 1,932 source surface vertices below the ankle, retaining indices and weights. An elongated rounded footprint, tapered ankle and shallow toe clefts replace the wedge end. Local displacement was limited at 130 vertices to prevent reversed faces. No added paw balls, new body or new skeleton. No degenerate or reversed triangles were found. Native rig and animation hash matches for the geometry-only edit.

| Revision | Walk maximum burial | Run maximum burial | Basis |
|---|---:|---:|---|
| Licensed original | 20.204 mm | 37.326 mm | Earlier native whole-mesh audit |
| Frozen refined geometry, native motion | 24.032 mm | 37.893 mm | Earlier geometry whole-mesh audit |
| Frozen refined geometry, corrected motion | 0.197 mm | 0.065 mm | Serialized whole mesh, every quarter key |
| Paw revision, corrected motion | 0.197 mm | 0.066 mm | Serialized whole mesh, every quarter key |

The corrected gaits use newly authored common stance speeds of 0.58 m/s Walk and 0.85 m/s Run. These are not native speed measurements. Native clip durations remain 0.708333313 s and 1.158333302 s. Anatomical two-bone solves on the original rig preserve chain lengths and use physical sole feedback. Whole-mesh checks sample 681 Walk and 1,113 Run times. Paw stance path errors stay below 0.439 / 0.839 mm; world stance drift per quarter key is below 0.372 / 0.627 mm. Sole centroid loops are exact; joint loop error is numerical noise.

**Significant visual risk:** reach-driven pelvis lowering reaches 53 mm Walk and 145 mm Run on the paw revision. This is a considerable crouch; contact passing does not establish natural gait. Root hardware review must judge the resulting posture, hocks, swing and silhouette before acceptance. Native Survey is unchanged and still has about 1.32 mm penetration. No blanket floor lift is applied.

The motion GLB adds 187,420 bytes over the 1,731,932-byte geometry candidate. Reproduce with `node art/rebuild/candidates/finish-quadrupeds/source-fox-adaptation/paw-refine.mjs`, then `node art/rebuild/candidates/finish-quadrupeds/source-fox-adaptation/motion-repair.mjs --paw`. Omit `--paw` only to deliberately rebuild the older geometry motion candidate. Full numerical evidence is in `paw-review.json` and `paw-motion-review.json`.
