# Mythic source candidate

Propose PixeliusVita Monster04, already imported as `creature_cinder_ravager`, for one `horned_demon` review candidate. Do not treat this proposal as visual acceptance or as an additional distinct silhouette when counting the existing catalogue.

The actual source preview at `test-results/creature-expansion/sources/monsters/cinder/Idle.png` shows an integrated horned cranial crest, defined shoulders and forearms, long claws, narrow waist and digitigrade feet. Retain that body, UV layout, skin weights and authored material atlas. Do not add wings for the first checkpoint. Review its source palette under production lighting before changing its material.

The existing `tools/creature-expansion/monsters/cinder.mjs` builder already retains six named source takes plus two directional hit derivatives. Its first claw contact is at normalized time 0.235. Its gait adaptation, floor corrections and stance measurements must travel with the source rather than being replaced by the rejected generic procedural clips.

## Other inspected sources

| Source | Evidence | Decision |
| --- | --- | --- |
| Monster09 / gorge mantis | `test-results/creature-expansion/sources/monsters/review-mantis/Idle.png` | Has real wings and good anatomy, but antennae and insect eyes identify it as an insectoid. Do not relabel it gargoyle. |
| DragonNightmare / quarry nightmare | `test-results/creature-expansion/sources/monsters/review-nightmare/Idle.png` | Plated four-legged dragon with long tail and head horns. Unsuitable gargoyle body. |
| Monster02 / regional miniboss | Entitled source inventory, existing converter and distant `test-results/creature-lab/miniboss-miniboss_galeskin.png` | Available rig; existing screenshot is too distant for source-body selection. |
| Dragon for Boss Monster PBR | `art/rebuild/candidates/finish-bestiary/source-inventory.json` lists DragonSoulEater, DragonUsurper, DragonTerrorBringer and DragonNightmare | Dragon inventory is not proof of gargoyle anatomy. No relabeling proposed. |

## Provenance

`Fantasy Monster 3D Model 04 - Game Ready - PixeliusVita.unitypackage`, publisher PixeliusVita, appears in the local entitled source inventory under the Standard Unity Asset Store EULA. Existing source path is `Assets/Stylized3DMonster/Monster04/Monster04_AllAnim.fbx`; existing atlas is `Monster04_Color03.png`. Use the inventory package hash and derived output hashes when staging the candidate.

## Integration needed

Load the existing production GLB through a CPU decoder retaining all mesh attributes, skin inverse bind matrices and animation tracks, or run the established Cinder builder in the integrator's conversion session. Keep authored textures through the candidate exporter's texture-binding route and preserve its `animal_` material prefix. Render only this one source-body candidate before making further mythic changes. The original gargoyle and revised procedural gargoyle remain rejected.
