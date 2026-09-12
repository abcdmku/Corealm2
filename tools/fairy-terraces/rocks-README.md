# Pure Nature boulder candidates

Run from the repository root:

```powershell
python tools/fairy-terraces/rocks-stage.py
node tools/fairy-terraces/rocks-build.mjs
```

Both tools write only to ignored `test-results/fairy-terraces-assets/rocks/`.
`candidates.json` follows the existing fairy staging catalog, including production-relative `asset.file`, staged `files` mappings, package provenance and unaccepted status. Nothing is promoted to public assets.

`fairy_boulder_4` and `fairy_boulder_0` use the entire original `Boulder_4_LOD0` and `Boulder_0_LOD0`, respectively. All 3,028 and 1,390 triangles remain. The original centimetre coordinates are converted to metres, centred in XZ and translated vertically so minimum Y is zero. No sculpting, decimation, smoothing, added support or UV changes occur. The builder verifies every position, normal and original UV against the serialized GLB roundtrip.

The source package is the user's locally downloaded BK `Pure Nature 2 : Asian Mountains`, Unity Asset Store ID 341972, acquired version 1.1. The package header, archive SHA256, original model/material/prefab/texture hashes and exact shader source are recorded. The official product URL is `https://assetstore.unity.com/packages/3d/environments/pure-nature-2-asian-mountains-341972`, under the Standard Unity Asset Store EULA.

## Material bake

The original `BK_StandardLayer_Mask.shader` and `.mat` parameters determine the bake:

- Original rock albedo and normal use unchanged UV0.
- Original `Grass01_a.png` and `Grass01_m.png` use source world-space triplanar projection and `_Tiling=.05`.
- The source `TOPDOWN` blend is `pow(saturate(normal.y + .25), 49.951)`.
- Original `_RockDetail1_n.png` supplies the second triplanar normal at `_Tiling2=.15` and `_SecondNormalPower=.5`.
- The original rock/grass masks are converted to glTF occlusion, roughness and metallic channels. Source smoothness and occlusion powers are both zero, producing fully rough, unoccluded surfaces as in the supplied material.
- The material references grass normal GUID `f3854bd7648c4b2e825b724bd7450464`, which is absent from the supplied archive. The Unity flat bump default is retained. No replacement texture is fabricated.

The source triplanar detail is baked at native scale and source origin into 2048 atlases, with linear-light colour blending, bilinear sampling and eight pixels of island padding. Image rows are flipped for glTF's texture convention; UV coordinates remain bit-identical. The resulting albedo, tangent normal and ORM maps are WebP and each GLB must stay below 3,000,000 bytes. Rotating or scaling an instance moves the baked detail with it, instead of reprojecting world-space texture at runtime.

Geometry checks are asset evidence only. Root owns production feature-lab screenshots and acceptance before public promotion or world placement.
