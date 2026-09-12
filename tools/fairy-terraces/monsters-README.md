# Fairy and universal miniboss candidates

These tools stage source assets for root-owned production feature lab acceptance. They do not edit the public asset manifest or create world spawns.

1. Run the existing `extract_sources.py` if `.asset-cache/fairy-terraces/unity/sources.json` is absent.
2. Run `python tools/fairy-terraces/monsters-stage.py` to extract the separate Unity transform animation files from Monster 07, 08 and 09 into the ignored output directory. The general extractor intentionally did not copy `.anim` files.
3. Run `npx tsx tools/fairy-terraces/monsters-build.ts`. An optional `--only=fantasy_monster_01,fairy_monster_11` selects IDs.
4. Run `npx tsx tools/fairy-terraces/monsters-audit.ts` for skin attributes, sampled deformation, floor clearance and horizontal root travel.
5. Root supplies `test-results/fairy-terraces-assets/monsters/candidates.json` to the normal production lab through `--catalog`, then records state and screenshots before promotion.

`fantasy_monster_01` through `fantasy_monster_09` use the nine individually supplied PixeliusVita packages. Their six gameplay clips are original source animation, named Idle, Walk, Run, Attack, Hit and Death. Monster 01 through 06 embed takes in the FBX. Monster 07 through 09 use Unity YAML quaternion, position and scale curves; the converter reuses the existing audited Hermite sampler in `tools/creature-expansion/monsters/mantis.mjs`.

Monster 07 through 09 retain source hovering locomotion. Their moving toes are not planted support contacts, so the converter and catalog omit `impliedWalkMps` and `impliedRunMps` for those three. Source animation and durations remain unchanged. Use `npx tsx tools/fairy-terraces/monsters-build.ts --refresh-metadata` to apply the same policy to staged metadata without opening a browser or rewriting GLBs. This verifies each retained output hash first. The old toe measurements remain in the per-body audit as non-contact diagnostics, not stride calibration. Native hover cadence still requires production browser motion proof.

`fairy_monster_11`, `_14`, `_16`, `_21`, `_27` and `_30` use bodies from the supplied FreeTrial 30 Monster Stylized Fantasy Vol 01. That archive contains thirty bodies numbered 07 through 36. It includes only Idle and Walk for each body. The selected ordinary creatures retain those source clips; Run uses Walk, and attack, recoil and collapse are newly authored skeleton poses. They are documented as adaptations and are not claimed to be source combat animation.

Source geometry, skin weights, UVs and authored albedo remain intact. Texture dimensions are capped at 1024 and encoded as WebP. The source monster packages have no normal maps, so their legacy material slots must not be mistaken for normal textures. Source units become metres, root X/Z travel is removed because gameplay owns position, and sampled root Y correction keeps animated geometry above the floor. Small ordinary bodies are uniformly sized to approximately 0.95 m, with the stronger 27 and 30 bodies approximately 1.45 m. No mesh decimation or replacement body is used.

The candidate catalog records the local entitled source package, full archive hash, source model and texture paths, output hash, source clip names and every adaptation. Each per-body audit records sampled bounds and floor corrections. Numeric source checks do not replace gameplay, motion or material inspection in the production lab.
