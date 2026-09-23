# Flint Mandible candidate

This folder contains an isolated native-rig candidate for the approved prior-batch Flint Mandible source. The builder reads the pinned Tripo export and approved reference image, then writes the candidate GLB, three 2K texture maps, `catalog.json`, and `lab-catalog.json` here.

From the repository root, regenerate the package with:

```powershell
node assets/art/tripo/imports/creatures/nine-pack-two/flint-mandible/build-candidate.mjs
```

The builder stops if either pinned SHA-256 changes. It retains the source mesh positions, normals, UVs, indices, and 4,178 triangles. The source skin has eight joints, no clips, identity rest transforms, and more than 99.999% of its weight mass on `bone_0`; the candidate replaces it with a 30-joint Y-up rig for a six-legged body plan facing +Z.

The approved 8K base-color atlas is downsampled to a 2K runtime albedo without recoloring. A tangent-space normal map and an occlusion/roughness/metallic map are derived from that painted mineral relief. The runtime material is non-metallic and rough. The six clips are `Idle`, `Walk`, `Run`, `Attack`, `Hit`, and `Death`.

`catalog.json` records pinned source provenance, candidate hashes, rig and map details, and structural build checks. `lab-catalog.json` packages the candidate metadata for root integration. All candidate acceptance fields remain false and pending root lab review. The production manifest and final world are unchanged; the root-owned manifest slot required by the lab importer must be handled during integration.
