# Dungeon Skeleton source candidate

The soldier, archer and mage skeleton variants use this path. Other rejected undead candidates remain unchanged.

`extract.py` verifies the reviewed local Unity entitlement package SHA-256, extracts it to ignored `test-results/rpg-bestiary-skeleton`, and converts its equipment TGA to PNG without repainting. Pillow is required. Source meshes and textures are not copied into this code directory.

`index.mjs` preserves the original mesh vertices, normals, UV coordinates, material groups, 30-bone hierarchy, skin weights and bind matrices. The model has one skinned mesh with 3,606 vertices. Original painted diffuse maps are handed to the CPU exporter through `meta.textureBindings`. The package supplies no normal or roughness maps; the Unity material's 0.2 smoothness becomes 0.8 roughness, with zero metallic.

Idle, Walk and Attack come from the three original FBX takes. Run is an accelerated Walk proposal. Hit, HitLeft, HitRight and Death are visibly marked proposals built over the original idle pose. They are not represented as source-authored animations or accepted gameplay. Exact skinned geometry floor correction is sampled at 120 Hz. Root motion correction does not alter joint animation timing.

The parent exporter must bypass rigid `skinArticulated` conversion for this already-skinned asset, preserve multi-material groups, and attach the two PNG images to matching materials after adding its `animal_rpg_skeleton_soldier_` prefix. Each binding specifies `flipY: true`: flip the image rows once before embedding, matching the original FBX texture convention and Three's normal GLTFExporter image path. Do not also flip the UV coordinates. The hierarchy has 30 bones, of which 24 are weighted skin joints. No GPU or browser is used by this builder.

Source publisher: Polygon Blacksmith. Package: Dungeon Skeletons Demo. License: Standard Unity Asset Store EULA through the locally entitled cache. Reviewed SHA-256: `9e9e40c66eda22d756dd256bf670fcf5edc28bf0b4bba5026daa204791fdf23c`.

## Role variants

`variants.mjs` removes complete disconnected sword components from the archer and mage, then compacts the retained attributes so invisible source weapon vertices cannot affect bounds. The mage removes the helmet too and retains 2,910 vertices. Both retain the source bracer that supplies the middle forearm geometry.

`unhorned.mjs` removes only the two disconnected 26-triangle helmet horns from soldier and archer. The original 92-triangle helmet bowl remains. The resulting soldier has 3,450 source vertices and the archer has 3,186. Retained anatomical attributes, rig/bind matrices and every clip value are unchanged; the mage is unchanged. Removal runs after the existing conservative floor correction to preserve those clip curves exactly.

The archer adds a recurved bow with wrapped grip, horn tips, two animated string segments, a nocked arrow and a leather quiver with feathered shafts. Its source-rig Attack uses two-bone arm IK to draw to the string. The arrow vanishes at phase 0.5, `ArcherRelease` supplies the launch point, and the string snaps forward after release. Gameplay owns the flying projectile.

The mage adds an open cloth hood, split mantle, clasp and wood staff with brass crown and crystal. Its role Attack raises the staff and extends the free hand at phase 0.56. `MageCast` supplies the casting point. Gameplay owns the spell effect.

Both role Attacks are Corealm-authored poses on the source rig, not renamed source melee attacks. Source locomotion retains its leg/body curves with derived role arm poses. The proposed run, hit and death limitations still apply. The exporter must preserve attached regular meshes as children of the source bones alongside the existing SkinnedMesh. Role details and gameplay contacts require production review.
