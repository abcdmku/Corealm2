# Strata Delver candidate

This folder holds an isolated candidate for the approved prior-batch Strata Delver source. It is not registered in a production catalog or asset manifest. All image, geometry, rig, motion, texture, lab, and integration acceptance flags stay false until the root feature-lab review.

## Source record

- Batch: `beetle-golem`; source audit approved; no other candidate found.
- Tripo model: `707c39cd-4a8e-40c4-8ecf-ca03814e8a06`.
- Approved image: `3432b9ea-8266-46e8-882f-47e840ea1750`, stored at `assets/art/tripo/references/stone-strata-delver.png`.
- Raw export: `assets/art/tripo/exports/corealm_strata_delver_707c39cd_8k_rigged.glb`.
- The build script checks both approved SHA-256 values before it writes anything. The complete audit is in [source-audit.json](./source-audit.json); generated candidate facts and validation are in [catalog.json](./catalog.json) and [lab-catalog.json](./lab-catalog.json).

The export has one skin, no clips, ten collapsed joints, a single 8192px base-color atlas, and source weights dominated by `bone_0`. Its mesh contains 3,238 vertices and 5,310 triangles. The rebuild replaces the skin and weights without changing positions, normals, indices, vertex order, or UVs. It recognizes six disconnected leg assemblies and gives each its own pivot; root, body, head, and tail complete the ten-joint rig.

## Build

From the repository root, run:

```powershell
node assets/art/tripo/imports/creatures/nine-pack-two/strata-delver/build-candidate.mjs
```

The script uses the repository's `@gltf-transform/core`, `@gltf-transform/extensions`, `three`, and `sharp` packages. It writes the candidate GLB, inspectable 2K texture sidecars, source audit, and local catalogs only into this folder. It checks geometry hashes, weight normalization, texture dimensions, and the six clip names before reporting success.

## Texture and motion notes

The layered approved base color is retained as the atlas source and resampled from 8K to 2K with its UV layout unchanged. The 2K tangent normal map derives multi-scale height from the source atlas contrast. The packed 2K ORM map uses red for occlusion, green for roughness, and blue for metallic; the metallic channel is zero because the material is stone. The source atlas itself contains no authored normal or metallic-roughness maps, so the derived channels need visual review in the lab.

The candidate includes `Idle`, `Walk`, `Run`, `Attack`, `Hit`, and `Death`. The gait alternates a three-leg tripod pattern. Review leg pivots, the negative-Z head orientation, texture response, and all six motions in the production-backed creature lab before changing any acceptance flag or wiring the asset into the game.
