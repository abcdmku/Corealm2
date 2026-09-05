# Unaccepted candidate checkpoint

These files preserve work for parallel worktrees. They are outside the public game directory and do not change its asset manifest. See the [handoff](../../../../runs/corealm-rebuild/PARALLEL-HANDOFF.md).

| Folder | Status |
| --- | --- |
| `trees` | Six v2 oak/pine candidates. Fuller crowns; complete current visual review and world acceptance pending. |
| `cliffs` | Sunder/Scree v4. Geometry and approach footprint checks pass; production visual/terrain/nav acceptance pending. |
| `minerals` | Eight inventory models, with latest amber/opal/garnet v5. The five unchanged candidates had earlier review; the latest three still need production and icon review. |
| `ground-gaits` | Two frogs and crab. Dense physical audits pass; natural translation/turn/blend review and promotion pending. `promotable` in the original physical report describes that gate only, not final acceptance. |
| `ground-ore` | Only the latest quieter copper candidate is current. Material, collider and work-position acceptance pending. Other earlier ground-ore exports were not copied because they are stale. |
| `scorpion-wip` | Failed first candidate, dense report and exact first-candidate source snapshot. The current solver source is newer and stops before export at its anatomical guard. Do not promote. |

Each folder contains `catalog.json`, compatible with `tools/lib/assetCandidates.ts`. `inventory.json` records snapshot GLB bytes and hashes. Catalogue/source licenses remain applicable. Do not interpret this archive as permission to publish third-party source archives.

Rebuild trees using the preserved `runs/corealm-rebuild/checks/stage-trees.ts` followed by `tree-browser-catalog.mjs`. The ordinary nature generator currently writes public outputs by default, so use the staging script for candidate work. Rebuild cliffs with `tools/build-corealm-geology.ts --only corealm_sunder_ledge,corealm_scree_slide --out test-results/sunder-ledge`; minerals with `tools/build-corealm-minerals.ts`; frog/crab clips with `tools/repair-ground-creature-gaits.ts`. Run TypeScript tools through `npx tsx` from the repository root.

Rebuild copper with `npx tsx tools/build-ground-ores.ts --only corealm_ore_grithe`. Its quiet albedo source and generation/provenance note are `tools/data/ground-ore-muted-albedo.png` and `.json`. The image edit did not preserve atlas masks, so the source records the restricted albedo sampling region and separate original normal/roughness UVs. This needs visual judgment; it is not an accepted texture solution merely because it exports.

The scorpion stopped-round state and exact source/export difference are in `scorpion-wip/README.md`. No failed or unreviewed candidate should replace live assets merely to make a checkpoint test green.
