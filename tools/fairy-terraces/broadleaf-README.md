# Fairy broadleaf candidates

The four candidates use BK Pure Nature 2 Asian Mountains Osmanthus 3 and 4. Both have broad crowns, forked trunks and native LOD0 meshes below 7,200 triangles. The source Nectarine trees were inspected and rejected for this role because their crowns are sparse and upright.

Run from the repository root:

```powershell
python tools/fairy-terraces/broadleaf-stage.py
node tools/fairy-terraces/broadleaf-build.mjs
node tools/fairy-terraces/broadleaf-hero-build.mjs
```

Outputs stay in `test-results/fairy-terraces-assets/broadleaf`. `candidates.json` contains the manifest candidates, asset hashes, source provenance and staged GLB paths. These scripts do not edit the public catalog or integrate the world.

| Asset | Native tree | Full size in metres | Native triangles | Leaf palette |
| --- | --- | --- | --- | --- |
| `fairy_canopy_gloam_1` | Osmanthus 3 LOD0 | 7.59 × 8.94 × 7.62 | 6,475 | Muted plum |
| `fairy_canopy_gloam_2` | Osmanthus 4 LOD0 | 7.61 × 9.64 × 7.62 | 7,194 | Rose |
| `fairy_canopy_fae_1` | Osmanthus 3 LOD0 | 7.59 × 8.94 × 7.62 | 6,475 | Lavender |
| `fairy_canopy_fae_2` | Osmanthus 4 LOD0 | 7.61 × 9.64 × 7.62 | 7,194 | Pearl lavender |

The original tree origin sits at the trunk. XZ is retained. The output is rigidly grounded to minimum Y zero. The candidates set `groundY` to `1.26993248` for the first shape and `1.17245972` for the second. Use `AssetRegistry.baseY()` for placement. It returns this authored ground line so the native root tips sit underground. Do not add a second root sink after this adjustment. Full bounding-box height includes the buried roots.

`trunkRadius` conservatively covers the native bark from the source ground line to 1.8 metres above it. The measurement clips bark triangles at both slab boundaries and includes a 3 cm margin rounded upward to centimetres. Source measurements and the resulting radius are recorded in each audit. The manifest category is `nature` and semantic type is `tree`.

The leaf source atlas has white leaves intended for shader coloring, plus warm twig regions. Only the leaf region receives the new palette. Native alpha, UV0 and normal maps remain. The trunk retains its original albedo and normal map. The output adds mild crown color variation; source vertex colors contain wind channels and are not suitable as glTF surface colors. The engine should supply its normal tree wind and should not multiply these already colored materials by the old fairy palette.

Every output passes an exact position, normal and UV comparison after GLB roundtrip. Textures use WebP with source alpha. Original leaf textures are 1,024 square; trunk textures retain their aspect ratio at 512 × 2,048. All GLBs are about 1.34–1.44 MB.

The source archive and every model, prefab, material and texture used are recorded with SHA-256 hashes in the candidate audits. The pack uses the Standard Unity Asset Store EULA, as recorded for the already integrated BK boulders. Browser lab acceptance and final world composition remain pending.

## Mature village tree

`broadleaf-hero-build.mjs` appends `fairy_hero_gloam` to the candidate catalog after the four Osmanthus variants. It derives from the existing `corealm_oak_1` asset and retains its original Corealm pack provenance. The mature oak has a thick divided trunk, lifted boughs and a broad crown. The other native oak candidates were inspected; oak 2 is taller and leaning, while oak 1 better suits the central village tree.

The hero preserves every original accessor exactly, including positions, indices, normals, UVs, vertex colors and normalized storage encodings. Bark, roots, ground line and trunk radius are unchanged. The source leaf atlas retains its alpha and fine veins; green leaf pixels become purple and warm twig pixels remain brown. WebP encoding reduces the GLB from 3.28 MB to 2.17 MB.

Its native dimensions are 13.97 × 15.50 × 13.13 metres with 35,330 triangles, `groundY: 0` and `trunkRadius: 0.686`. At uniform scale 0.85 the crown is 11.87 metres wide and the tree is 13.17 metres tall. Hero lab acceptance and composition proof remain pending.
