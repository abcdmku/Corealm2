# Shalewake candidate

This folder contains an isolated runtime candidate for the approved Shalewake source. It is not wired into production. Every candidate acceptance flag is `false` until the root feature lab reviews the rig, animation, texture response, and normal-camera screenshots.

## Build

Run from the repository root:

```powershell
node assets/art/tripo/imports/creatures/nine-pack-two/shalewake/build-candidate.mjs
```

The builder uses the repository's installed `@gltf-transform/core`, `three`, and `sharp` packages. It checks the exact approved source and reference hashes, replaces the root-only Tripo skin without changing positions, normals, indices, or UVs, builds the 2K runtime maps, authors six clips, samples their skinned deformation, and writes the candidate plus local catalog and provenance files in this folder. It only reads the root-owned asset manifest to confirm that the existing Shalewake asset ID is available for a later lab override.

## Source and rig findings

- Tripo model `da0d598a-9330-4856-a88f-6341c1da299d` uses approved image `8a12eddb-3390-4475-9270-bc4efcacb8d3` from `assets/art/tripo/references/stone-shalewake.png`. The approved source audit is recorded under batch `shale-elemental`.
- The raw export has 3,188 vertices, 5,294 triangles, one skin with five joints, no clips, and an 8K generated base-color atlas. Weight mass rounds to 100% on `bone_0`; the builder measures other-joint residual below 0.0001%. The source has no normal or metallic-roughness texture.
- Mesh bounds are approximately X `[-0.261, 0.261]`, Y `[0, 0.476]`, Z `[-0.500, 0.500]`. The two small sensing forms at positive Z and the four separated paw/limb groups indicate a low quadruped facing +Z. This orientation is inferred from the source geometry and approved image.
- The candidate uses 20 joints: a pelvis/spine/chest/neck chain, paired sensing-cleft joints, and upper/lower/paw chains for each fore and hind limb. Its connected-island masks distribute weights across the actual four-limb body plan.
- The source atlas is preserved and reduced to 2K. The tangent normal is derived at restrained strength from softened atlas luminance; the packed metallic-roughness map sets metallic to zero and varies high stone roughness. These maps still need root lab material review on the animated model.

## Files

- `stone-shalewake-native-rig-candidate.glb` — skinned candidate with embedded 2K maps and `Idle`, `Walk`, `Run`, `Attack`, `Hit`, and `Death` clips.
- `shalewake_basecolor_2k.jpg`, `shalewake_normal_2k.jpg`, and `shalewake_metallic_roughness_2k.png` — inspectable sidecar maps that match the embedded maps.
- `catalog.json` — geometry, rig, map, clip, and structural-sampling results. All acceptance flags remain false.
- `lab-catalog.json` — local candidate mapping for the existing `creature_shale_elemental` asset ID, with lab acceptance false.
- `provenance.json` — exact model, source image, reference, export hashes, audit status, and candidate hash.
- `build-candidate.mjs` — reproducible builder and its integrity checks.

The builder does not modify `game/public/assets/manifest.json`, any game source, or any other import folder. A passing builder check establishes mesh/skin integrity and sampled deformation; it does not establish gameplay motion or visual acceptance. Root lab proof remains required before any production integration.
