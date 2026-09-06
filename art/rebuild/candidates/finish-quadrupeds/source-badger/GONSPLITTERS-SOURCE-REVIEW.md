# Provisional complete Badger source

The source mesh and a normalized static GLB are acquired and ready for hardware source review. **The publisher declares CC-BY-SA 4.0, but the exact original creator grant has not been independently verified. Do not promote this candidate to commercially cleared production assets yet.**

`candidate-catalogue.json` targets `creature_rootdelve_badger`. Its local file mapping resolves `gonsplitters-badger-preview-normalized.glb` (3,111,332 bytes; SHA256 `65c9eca2fb53ad20770937306a5a133beff36b765045f3c0a7a2ce9c036cdd79`). It contains the original complete posed mesh, 49,976 triangles, and zero skins or animation clips.

The wrapper applies uniform scale `0.8610104898` and translation `[0.0322663658,-0.0874984623,-0.0922379552]`. Final dimensions are approximately `0.39788 × 0.35 × 0.66566` m. Ground is the minimum drawn vertex. The positive-Z end carries the white facial-mask texture samples; the original slight head angle remains. This is authored preview scale, not a measured zoological claim. No vertices, UVs, textures, topology or authored pose were changed by normalization.

## Acquisition and attribution evidence

- Official package: https://thunderstore.io/c/talespire/p/Gonsplitters/Gonsplitters_Beasts_Collection/
- Official public download: https://thunderstore.io/package/download/Gonsplitters/Gonsplitters_Beasts_Collection/1.0.3/
- Archive SHA256 `ef00545e513c4b3008947418b784f22288cc9a654234591bda456fd1a94f0e86`, 51,656,897 bytes.
- Bundled README credits mz4250 for the models, with separate sheep and wolf credits. It explicitly declares the models and package CC-BY-SA 4.0. The complete license is preserved as `gonsplitters-LICENSE`; README as `gonsplitters-README.md`.
- Badger bundle SHA256 `3103ab112e7a97790b67d8655b71401e126ef6184877cc3050d1b398c2006ea9`.
- Original creator page: https://thangs.com/designer/mz4250/3d-model/Badger-18694 . Search/browser-text retrieval confirms the Badger upload by mz4250, but its retrieved page contains no license declaration. Direct HTTP acquisition returned a challenge and was not bypassed.
- Creator post https://mz4250.com/posts/appendix-updates-58583354 identifies Giant Badger work and public files, but does not establish a license for this exact Badger mesh.
- Creator post https://mz4250.com/posts/monster-manual-130515498 says the Badger from the original collection remained unchanged in the 2025 collection. This supports authorship context only, not the precise redistribution grant or geometric identity.
- The creator's Printables profile was checked, but this bounded search did not resolve an exact Badger original listing with its license. Free availability alone is not being treated as commercial permission.

This is a declared derivative redistribution with explicit attribution, not an anonymously sourced game rip. The remaining gap is exact original creator permission. Preserve author, source URL, package attribution, license and modification notices if later cleared. The source review catalogue retains this uncertainty explicitly.

## Static extraction and material translation

`inspect-gonsplitters.py` uses an isolated UnityPy installation in `python-lib/` to read mesh, texture, material and transform data. No package game code ran. `python-lib/` is disposable tooling and should not be committed. `export-gonsplitters-preview.py` runs existing portable Blender with `--background --factory-startup --disable-autoexec`, imports the extracted OBJ and exports the static GLB. No GPU or browser was used here.

Original maps are preserved. The GLB uses original albedo plus explicit saved tint, reconstructed DXT5nm normal, original AO, roughness derived from source gloss alpha, zero metallic and opaque backface culling. Unity parallax height is omitted because standard GLTF has no equivalent. Material fidelity still needs hardware review. Original source GLB is preserved separately from its normalized wrapper.

`validate-preview.py` checks GLB sizes, finite positions, world bounds after node rotation, explicit tint, culling and absence of invented clips/skins. `gonsplitters-preview-validation.json` records results. Source positions remain unchanged; two GLTF vertices are split for normal/UV representation.

The official collection preview and original portrait were inspected. They show a natural stocky masked badger body but do not resolve all feet. Hardware whole-body and feet inspection remains required. Do not infer animation capability from the static source.

## Material v2 correction after hardware review

All four hardware captures in `test-results/quadruped-source-geometry-comparison/` were inspected. The original preview shows wet golden glitter on the black coat. CPU comparison identified a precise conversion error: Blender ignored the arbitrary SUBTRACT node and exported Unity smoothness alpha directly into GLTF roughness green. These two channels were pixel-identical. The frozen preview remains preserved.

`candidate-catalogue-material-v2.json` selects the separate `gonsplitters-badger-preview-material-v2.glb`, SHA256 `addd10e790b62aa1350cb0cbdc1b23090ecd488dc4da3d42d7c2311145d3dfa8`, 3,511,656 bytes. `correct-material-preview.py` explicitly packs original occlusion, inverted smoothness and original zero metallic into RGB. Corrected roughness is 113–255 (mean 199.53); the broken preview was 0–142 (mean 55.47). Geometry, nodes, original albedo and existing binary bytes remain unchanged; only a corrected packed image is appended and selected.

The saved Unity material has `_METALLICGLOSSMAP`, `_SmoothnessTextureChannel=0` and `_GlossMapScale=1`, matching [Unity's metallic/smoothness documentation](https://docs.unity.cn/Manual/StandardShaderMaterialParameterMetallic.html). Normal-map red is identically 255; decoded X matches original alpha exactly and Y matches original green exactly, consistent with [Unity's normal unpack convention](https://github.com/Unity-Technologies/Graphics/blob/master/Packages/com.unity.shadergraph/Documentation~/Normal-Unpack-Node.md). Original albedo is pixel-identical. No repaint or anatomy change was made. The material correction still requires a hardware comparison before coat acceptance, and original-creator rights remain unverified.

## Other archive contents

The archive contains ape, badger, crab, crocodile, deer, elephant, frog, octopus, panther, polar bear, raven, sheep, snake, wolf and spider. It contains no horse, moose, ram, tapir or fox. The sheep is credited to ZERTUX; wolf to PRINTEDENCOUNTER; remaining meshes to mz4250 by the publisher. No other mesh was converted or independently cleared in this task.
