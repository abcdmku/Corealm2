# Equipment candidates

Twenty-four original Corealm weapon GLBs. These are review candidates and have no production item bindings.

Regenerate with `npx tsx tools/build-corealm-equipment.ts`. `catalogue.json` supplies measured bounds, bytes, hashes, material names and local grip centres for `installAssetCandidates`. GLBs embed their wood and leather textures and use at most five material draws per model.

The six forms are sword, dagger, axe, shield, staff and wand. Suffixes 1 through 4 correspond to the existing level 1, 5, 10 and 20 progression. Sword blades have different authored profiles. Dagger grades share the existing production dagger geometry. Other grades vary materials and restrained dimensions; they are not counted as different weapon families.

Source: `game/src/render/equipmentWeapons.ts`, `game/src/render/proceduralGearModels.ts` and `tools/build-corealm-equipment.ts`. License: `LicenseRef-Corealm-Original`. No Knight Online models, icons or textures are included.

The first six-family hardware review found a duplicate shield-rim endpoint and an axe bevel intersecting a thick head slab. Both construction errors are fixed in this catalogue. Shield and axe reruns were inspected and show the repaired construction. These files have not passed held-animation or final icon acceptance. See `runs/corealm-rebuild/EQUIPMENT-PACKAGE05.md` for exact sockets and remaining checks.
