# Beetle Golem source adapter

`beetle.mjs` exports synchronous `buildBeetleGolem(id = 'stone_golem')`, returning `{object, clips, meta}`. This is the complete original body, with no grafts, recolor variants or added body parts.

Source: [Beetle Golem Animated](https://opengameart.org/content/beetle-golem-animated). Model and original rig by killyoverdrive; animation by Dm3d. License CC BY-SA 3.0. The original model page is https://opengameart.org/content/beetle-golem-0. The adapted creature asset retains CC BY-SA 3.0, and the returned metadata includes full attribution and the license URL.

The official download is https://opengameart.org/sites/default/files/BeetleGolem_v3.blend. SHA-256 of the downloaded file: `cb730dd5dcf0f25835bd276dfd6bf38cb1d55a1d4ccefa7e94391ee0ce412c42`. The file was opened with the team's verified portable Blender 4.5.11 using `--background --factory-startup --disable-autoexec`. No scripts in the source file were executed. No renderer or GPU was used.

Native source facts:

- One creature mesh with 312 control vertices, 620 triangles and 29 bones. The presentation floor, lights and camera are excluded.
- Two original packed 1024-square PNGs: color and tangent-space normal. Exact packed bytes are retained in `derived/original-map-*.png`, with hashes in the source inventory. Image rows are flipped once for glTF while retaining original UVs.
- Eleven separate native actions retained in `derived/source.json`, including both attacks, both hurt reactions, normal/heavy idle, walk, death and sleep actions. The old combined animation timeline remains in the untouched original blend.
- Runtime clips map Idle to Idle_Normal, Walk to Walk, Attack to Attack1, Hit/HitLeft to Hurt1, HitRight to Hurt2 and Death to Death. Run derives from faster Walk because no native Run exists. All actions are sampled at 48 Hz with their original 24 fps timing.

The helper normalizes height to 2.55 m and adds sampled floor correction. It reconstructs the source rig from original inverse binds and local pose matrices. Comparing the full native-weight reconstruction against Blender's evaluated original mesh over 33,480 vertex samples gives a maximum error of 0.000000982 m. This verifies the coordinate, bind and pose conversion separately from the runtime weight approximation.

The source has up to eleven positive influences on a vertex. The current renderer supports four. Fifty-seven control vertices require reduction. A fit using four of their existing source influences gives 1.38 mm RMS and 21.29 mm maximum position error over 491,040 checked vertex samples. This limitation is recorded in metadata; the original weights remain in source JSON for audit. No replacement joints are created.

All eight runtime clips pass whole-geometry CPU floor checks. Minimum sampled clearance is 2.79 mm. Native aerial motion is retained. Attack contact timing remains provisional.

The source is deliberately low polygon and relies on its original normal map and baked color detail. Modern Blender loads its legacy material without shader nodes, so the helper explicitly maps the original color and normal channels and uses roughness 0.55 / metalness 0. No roughness, metallic or emissive maps were present. Browser material appearance, normal orientation, gait and attack contact still need the root's production lab review.

Rebuild from repository root with the recorded Blender executable:

1. Run `extract_maps.py` in background Blender.
2. Run `extract_source.py` in background Blender.
3. Run `node tools/rpg-bestiary/beetle-golem-source/sample_skin.mjs`.
4. Run `python tools/rpg-bestiary/beetle-golem-source/optimize_weights.py` using the existing NumPy/SciPy runtime.
5. Run `node tools/rpg-bestiary/beetle-golem-source/check_native.mjs` and `node tools/rpg-bestiary/beetle-golem-source/check.mjs`.

The official source preview and CPU reports are disposable files under `test-results/beetle-golem-source/`. Complete source facts and attribution are recorded in `tools/rpg-bestiary/replacement-inventory/beetle-golem.json`. No production catalog or shared build file was changed.
