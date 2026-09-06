# Roach source adapter

`roach.mjs` exports synchronous `buildRoach(id = 'cave_roach')`, returning `{object, clips, meta}`. It preserves the complete original body without grafts or geometry edits. No shared catalog, build, content or inventory file was changed.

Source: [Roach, game-ready and animated](https://opengameart.org/content/roach-game-ready-and-animated). Original model by Atmostatic; rig, animation and retexture by Danimal. Both authors and OGA must be credited. The asset and this adapted creature remain CC BY-SA 3.0. Complete attribution, URLs and SHA-256 hashes are in `source-record.json` and returned metadata.

The verified official ZIP URL is https://opengameart.org/sites/default/files/Roach.zip. Its SHA-256 is `038d01360b353a4d4ebaf1e67293f8554e67ebdb06f34627cbc9538489487594`. The source blend is the existing inventory-owned file at `test-results/fantasy-collection-source/roach-game-ready-and-animated/Roach.blend`.

The source has 1,695 control vertices, 3,004 triangles and 54 bones. Every vertex has at most two positive native weights. All weights are preserved. Reconstructed native skin positions match Blender's evaluated Armature modifier within 0.000000936 m over 162,216 vertex samples. The full-weight/runtime comparison over 2,676,564 samples is within floating-point precision. No weight refit or new bones are needed.

All ten original NLA clips and their action/timeline ranges are retained in `derived/source.json`. Native NLA strip timing matters: Walk plays source frames 10–50 in one second; Flee plays those same frames in 0.5833 seconds. The adapter preserves those authored timings. Source poses are sampled at 48 Hz, with the native 24 fps action timing recorded separately.

The returned runtime clips are Idle, Walk, Run, Attack, AttackSecondary, Hit, HitLeft, HitRight and Death. Run uses the native Flee strip. AttackSecondary preserves the second native attack. No source Hit exists: the three hit clips use the first 0.4167 seconds of native Idle with an authored SpineHigh pitch recoil and directional yaw. This derivation is explicit in metadata.

All nine clips pass whole-geometry CPU floor checks. Minimum sampled clearance is 1.75 mm. The native first attack has an aerial phase; it is retained. Height is normalized to 1.15 m without changing proportions. Attack contact remains provisional pending production gameplay review.

Three original 1024-square maps are retained byte-for-byte with hashes: Roach.png, RoachNormal.png and Roach-Spec.png. A direct SDNA decode of the original Blender 2.69 material confirms color mapping, normal strength 0.125 and specular intensity map strength 0.0212766. The source hardness is 50. Normal strength is baked into a derived tangent map, and color/normal image rows are adapted for glTF. The source maps themselves remain unchanged.

The current exporter has no native specular-intensity binding. The original specular map is retained in metadata, but is not bound in the first candidate. Constant roughness 0.65 is an explicit preview default; it is not derived from the specular image. No KHR_materials_specular or shared renderer change was made. This material limitation needs visual review.

Rebuild from repository root:

1. Run `extract_source.py` with the team's verified portable Blender 4.5.11 using `--background --factory-startup --disable-autoexec`.
2. Run `node tools/rpg-bestiary/roach-source/inspect_legacy_material.mjs` for direct legacy material evidence.
3. Run `node tools/rpg-bestiary/roach-source/check_native.mjs`.
4. Run `node tools/rpg-bestiary/roach-source/check.mjs`.

No GPU or renderer was used. Only the official source preview was inspected. CPU reports live under `test-results/roach-source/`. The root must inspect source material appearance, normal orientation, native gait, attack contact and derived hit reactions in the production lab before promotion.
