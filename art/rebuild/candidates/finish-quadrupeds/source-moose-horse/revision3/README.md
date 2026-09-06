# Moose source revision 3 — static review candidate

Revision 2 and its CPU renders remain frozen. This finish retains its complete CC0 horse-derived body and silhouette, joins the actual source pastern boundaries to paired hoof shells, closes both ear ends, and removes horse face diffuse/normal markings using a local material on the source triangles. Small local eye-region relaxation removes the strongest slanted folds while retaining the original embedded black eye meshes. Ear inner surfaces have modest color variation.

The four actual source boundary loops contain 30, 30, 16, and 16 vertices. Each connects through a triangulated coronet to two 16-vertex open shell tops. This replaces the previous overlap and closed shell caps. Material boundaries remain separate glTF vertices at identical coordinates; the positional seam audit at 1 micrometre precision checks 1,714 distal edges and finds zero open or nonmanifold edges. Both ears likewise have zero open or nonmanifold edges. This is local closure evidence, not a claim that the full original source body is manifold.

Body source-vertex interpolation weights are retained in body-source-vertex-map.json. They compose with ../rig-mapping.json back to the native rig provenance. UV interpolation maximum error is 2.95e-8; weight sums are exact. The missing native Bone.005 group remains unresolved. There are no skins or animations.

Source rights remain in ../../source-hoofed/LICENSE.md: Lyndon Daniels, CC0, https://opengameart.org/content/realtime-ranchers-3d-model-pack . Source images remain unchanged. Face treatment removes their use on 4,416 source face triangles, rather than repainting those images. Local additions are Corealm authored.

CPU Cycles front, side and three-quarter images were inspected. Eyes are readable and the strong slanted eyelid marking is reduced; some angular source mouth geometry remains. Tail hair tip and pale lower-leg markings remain unchanged from revision 2. This is not production browser/GPU acceptance.

The catalogue targets creature_marsh_moose with +Y up/+Z forward and identity wrapper. Rebuild from repository root with tools/creature-expansion/hoofed/source-moose-horse.mjs. CPU scripts here: validate-and-catalogue.mjs, audit-regions.mjs, audit-junctions.mjs, preview-cpu.py. The vertex count in cpu-validation sums primitive accessor counts; the local face primitive shares body position/UV accessors, so that figure counts those shared values twice.
