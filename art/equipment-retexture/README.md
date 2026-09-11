# Existing equipment textures

This revision uses the existing Knight armor and established weapon models. It removes the separate Knight scarf attachment from player melee equipment and changes materials and textures. It does not rebuild armor or weapon geometry.

The approved images in `art/item-icons/256/` supply material references. ImageGen produced the Knight, sword, and staff albedo atlases and the metal, wood, and leather tiles in `textures/`. Atlas edits use the original atlas layout. Original normal, metallic/roughness, and emissive maps remain bound.

`tools/equipment-retexture/build-candidates.ts` amends GLB JSON and verifies that original binary geometry, skinning, and animation data remain byte-identical. The catalog records source hashes, replacement hashes, and protected-state checks. Shared replacement images use content-addressed paths. Four runtime dagger models receive surface textures in the production material shader because they have no usable UVs.

Production integration is complete. `acceptance.json` records passing visual reviews for seven melee kits and 51 held items, eleven lab shards, and attack/casting proof. `promotion.json` records the 30 promoted GLBs and the passing full-world Corven equip/movement check. Root inspected its front, back, and walking captures. The normal production route loads the accepted textures without a lab override. Male captures provide visual proof; female mappings and unchanged geometry are checked separately.

`equipmentIconMaterials.ts` resolves item-specific metal, wood, leather, and socket colors. `equipmentSurfaceTextures.ts` applies generated grain to existing metal and dagger surfaces. The lab query `equipmentTextures=1` enables staged runtime materials before production acceptance.

Root runs `lab-test.ts` in serialized shards, then `combat-test.ts`. These use the production renderer, real equipment controls, normal gameplay camera limits, movement, and damage/casting receipts. Visual acceptance requires inspection of the captured PNGs, separately from the mechanical reports. `promote.ts` requires an explicit acceptance record and matching asset hashes before copying staged GLBs and textures.

## Withdrawn armor work

The procedural armor rebuild is withdrawn. Its 40 production manifest entries and 61 registry records were removed. The runtime now resolves catalog equipment to the established models. Automatic approval review rejected both bulk deletion and a bounded single-directory deletion, reporting that the actions were blocked by policy. The abandoned builders, candidates, and unused files remain on disk; they were not physically deleted. Approved icons and unrelated accepted assets are preserved.
