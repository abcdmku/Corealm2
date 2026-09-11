# Stone and cave creature authoring

These five candidates use production GLBs and native rigs. This directory never promotes a model or places a world encounter.

Run from the repository root:

```powershell
node tools/biome-creatures/stone/build.mjs
node tools/biome-creatures/stone/audit.mjs --apply
npx tsx tools/biome-creatures/stone/lab-test.ts
```

`build.mjs --only <id>` rebuilds one existing staged catalogue entry. Repeat the audit after every build. It hashes the final bytes, checks fully deformed bounds across every clip, and measures weighted sole travel over 180 phases. `--apply` writes those gait values into the candidate catalogue and records their GLB hashes in `art/biome-creatures/stone/gait-calibration.json`.

The staged catalogue is `test-results/biome-creatures/stone/catalog.json`, suitable for `installAssetCandidates`. Root integration owns the feature-lab candidate registry, asset promotion, canonical species registration, combat timing/locomotion ceilings, world assignments and placement acceptance.

| Creature | Authored anatomy and motion |
| --- | --- |
| Cairn Treader | Recessed head, broad shoulder shelf, shorter reaching arms and deeper palms. Native legs stay planted under its low torso. The chest transfers weight into the source punch. |
| Flint Mandible | A deepened shovel cranium, broad digging claws and thicker shell mantle. Its native rig makes a braced sideways digging sweep. |
| Vault Custodian | Knight helmet, chest, shoulder and hand shells replaced by a worn five-stone arch with a raised keystone, lintel fists and tapered limbs. Run derives from its heavy native walk at faster timing. |
| Blind Cave Weaver | Source eyes removed. Dorsal abdomen has a deep cleft and widened shell lobes; elongated forelegs search in opposite phases while the head scans. All eight native feet retain contact. |
| Scree Watcher | Every knight mesh replaced by one coherent family of eroded stone forms: tapered stilt legs, fused torso, enclosed split hood and flat forearms. Slow head scan and torso counter-turn retain the native attack and recoil rig. |

New limestone and chitin albedos and their exact imagegen prompts are recorded in `art/biome-creatures/stone/README.md`. All materials retain the `animal_rpg_` prefix so the production renderer preserves their authored surface response. Flint retains its licensed native chert maps. Derivatives retain parent provenance and licensing, including Beetle Golem's CC BY-SA 3.0 requirement.

Grounding is measured from actual weighted geometry at 120 Hz and stored per take. The browser driver samples production bounds and actions and lands normal combat hits. A successful script is not visual acceptance; root and a fresh critic must inspect the images. The whole-body floor measure does not prove every foot contacts the ground, so the separate weighted-sole audit is required.
