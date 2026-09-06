# Complete CC0 source horse adapted to tapir

Frozen static revision for root review. CPU inspection found improved rounded ears, seated small eyes, a shorter broader nasal bridge and flattened nail fronts. The side view still has an oversized rear barrel and a small head on a protruding narrow neck. CPU review is not acceptance; no production, motion or gameplay claim is made.

Lyndon Daniels authored the complete CC0 horse body and textures; ChadM authored the native rig derivative. See SOURCE-LICENSE.md and the preserved source-hoofed creator pages. The original riggedHorse.blend remains unchanged: SHA-256 9cca670b93a74d50e89263e50d55ab035a6c46aa7d2b21e354bdac6987037f4a.

Current GLB: tapir-source-static.glb, 2645832 bytes, 29662 triangles, three meshes, zero skins/actions, embedded normal texture. SHA-256 4c98b1920aa1dae31d15b2b614d51d34e351308f0594ea4ebf1e245fa57b6f2a. Review catalogue SHA-256 96eaa11b5731ece628413bd9efee2769641e568beb48f81d8694e5fcf56f323a. CPU reimport found finite vertices, no external textures, and zero boundary edges, nonmanifold edges or zero-area faces after positional welding at 1e-6 m.

The complete connected source body was spatially adapted across torso, legs, neck, skull, muzzle and short tail. Separate horse mane/tail hair was removed. Original ear roots connect to newly authored cupped rounded crowns; source pastern boundaries connect to new contiguous feet with three primary lobes, physical clefts, flat nail fronts and a smaller fourth outer forefoot projection. These are local source-region replacements, not immutable original topology. No capsule torso or separate head graft was added.

vertex-source-map.json preserves all 3,697 original body vertices, faces, groups, bones and corresponding positions before later neck edits, subdivision and ear/foot retopology. New regional topology has no original vertex index. The retained 19-bone rig is primary-warp authoring data only: it has not been fitted to final local edits. Native Bone.005 weights reference an absent bone; eyes are unbound and new regional vertices need weights. No action aliases were invented.

Measured original body width/length/height at 2.4 m normalization: 0.970310 / 3.330024 / 2.400000 m. Current width/length/height: 0.746328 / 1.975160 / 1.160977 m. Defined head region width/length/height: 0.353264 / 0.291089 / 0.279372 m; torso region: 0.684938 / 1.258525 / 0.579615 m. Head/torso length ratio 0.231294, width ratio 0.515760. region-measurements.json states exact geometric masks; these are edit measurements, not zoological landmarks. candidate.json records primary-warp bone lengths separately from final mesh dimensions.

Previous pre-nasal/nail revision is preserved in revision-before-nasal-nails. Final nasal edits compress reach beyond 0.94 m by 38%, broaden bridge by up to 42%, compress its depth by 47%, and shape an upper nasal overhang from the original muzzle. Eye radius is 34% of the first warped source eye radius.

The San Diego Zoo tapir reference (https://animals.sandiegozoo.org/animals/tapir) informed small eyes and ears, short prehensile nose, rear-heavy body, bristly coat and four fore/three hind digits. Numerical shapes are authored, not photo measurements. No reference image or texture was copied.

Build with node tools/creature-expansion/hoofed/source-tapir-horse.mjs. build.py uses background CPU Blender; validate.py checks reimported GLB; measure.py records region dimensions; finalize.mjs writes this report and isolated review catalogue. Six CPU stills cover front, side, rear, three-quarter, head and forefoot. Parent owns production lab and acceptance. No GPU/browser/public asset/shared generator was used.
