# Hoofed source acquisition

The acquired horse is a complete CC0 body worth production visual review. It is not ready for gameplay.

Lyndon Daniels created the [Realtime Rancher horse](https://opengameart.org/content/realtime-ranchers-3d-model-pack). ChadM supplied the [rigged derivative](https://opengameart.org/content/rigged-horse). Both source pages label it CC0. Original pages, license designation, downloads, hashes and creator previews are preserved here.

`horse_default_0.png` and `riggedHorse.jpg` were inspected before conversion. The full body has deliberate shoulder and haunch contours, a sculpted face and textured hair. Its large eye, coarse hoof rims and baked coat shading still need close production review.

`horse-source-static.glb` preserves all five source mesh objects and 14,986 triangles. It is uniformly scaled to 2.4 m tall and centered at the ground. Original diffuse, normal and hair alpha textures are embedded. Node materials replace obsolete Blender materials. No source body parts were replaced. CPU reimport verifies five meshes, five embedded textures, correct bounds, zero skins and zero actions. It has no animation and must remain a static source candidate.

The native rigged Blend contains 19 bones and a fully weighted body, but no actions. Mane, tail and both eyes have no weights or armature modifier. Original rig issues are recorded in `horse-native-inventory.json`. Reconstructing those bindings and authoring the required production clips is separate work.

The creator MTL contains stale texture directories. The static exporter resolves the original files explicitly and wires real normal maps instead of the MTL diffuse-as-bump entries. Original files remain unchanged.

WildMesh lists a free pack on its [creator Patreon](https://www.patreon.com/wildmesh/posts/free-models-160668973), but membership gates its attachments and no usable license was available. The Bighorn demo page returned HTTP 403. Neither was bypassed. No complete, accessible Moose, Bighorn or Tapir replacement was acquired in this bounded search.

`source-inventory.json` records the shortlist and exclusions. `downloads.json` records original byte hashes. The Blender helpers use CPU import/export only. No GPU capture, public asset changes, purchase or account signup occurred.
`review-catalogue.json` is the production asset-interception wrapper for `creature_marchwild_horse`. It records measured glTF bounds, exact bytes/hash, CC0 provenance, +Y up/+Z forward, and an identity runtime wrapper. It intentionally contains no animations or skin claim. Select only front, side, rear and gameplay still views for source review.
