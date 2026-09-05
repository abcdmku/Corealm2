# Model library audit

The current catalogue contains 348 GLBs from 26 packs, totaling 235.71 MB of GLB containers. Another 27.03 MB resides in 49 external image files, referenced 685 times. Every GLB was parsed; every material, image header/hash and animation name was inspected. This technical census does not grade visual quality.

Run `npx tsx tools/audit-model-library.ts` to regenerate this report and its per-model JSON record. The manifest, GLB and per-image hashes identify the inputs, including external file contents. No production assets are changed.

The retain/repair/replace assessments below preserve the original rebuild baseline. They have not been reassessed against the current models, source importers or gameplay and must not be read as current defect confirmations.

| Family | Models | MB | Retain | Repair | Replace |
|---|---:|---:|---:|---:|---:|
| animals | 22 | 10.64 | 0 | 22 | 0 |
| animation | 2 | 1.43 | 2 | 0 | 0 |
| architecture | 49 | 14.33 | 0 | 49 | 0 |
| elemental-bosses | 3 | 3.02 | 0 | 3 | 0 |
| humanoids-and-outfits | 72 | 101.12 | 0 | 72 | 0 |
| imported-shrine | 2 | 17.53 | 0 | 2 | 0 |
| legacy-platformer | 16 | 0.73 | 0 | 0 | 16 |
| minibosses | 4 | 3.11 | 0 | 4 | 0 |
| nature | 3 | 0.08 | 3 | 0 | 0 |
| props-and-farming | 60 | 4.63 | 0 | 60 | 0 |
| rocks-and-mining | 35 | 12.51 | 0 | 35 | 0 |
| trees | 20 | 6.42 | 0 | 20 | 0 |
| understory-and-deadwood | 50 | 41.06 | 0 | 50 | 0 |
| weapons | 10 | 19.08 | 0 | 10 | 0 |

## Historical rebuild findings requiring reassessment

1. The bear's white forelegs are an import defect. `tools/animals/convert.js` forces `flipY=false` on source FBX textures. The committed bear's 2,701 position/UV pairs match the source FBX. Its embedded texture matches the original TGA without vertical correction. Current front-leg UV samples are 36.32% white; vertically correcting the image reduces that to zero and restores brown fur. Correct and review every consumer of this shared importer before discarding usable source art.
2. The nature import deliberately removes normal, occlusion, metallic/roughness and emissive maps in `tools/build-assets.ts:1573`. All 50 nature assets have no normal or AO map. Shader color grading cannot recover the removed surface information or improve branching geometry. The tree families need coherent source geometry, textures, LODs and matching harvest states.
3. All 19 terrestrial animal variants and the three rhino bosses lack Hit. Rhino source Run is renamed Walk, while Get_Hit is omitted. Ten animal attacks use synthesized root lunges. Rebuild motion from source and articulated family profiles, then check contact and recovery in the production lab.
4. Ore is ordinary rock with raised rectangular vein strips. `entityViews.ts:3816` projects only strip endpoints, guesses height on misses, and sends every branch to the same side because indices 1, 3 and 5 are all odd. Depletion adds fixed forward-facing scars to an intact rock. Replace ore uses with matching geological host, vein and extraction-state geometry.
5. Shrine site has 63 material definitions that differ only by name. Named architectural meshes drive collision in `structureNavigation.ts`, so unrestricted geometry merging would break gameplay. Deduplicate materials and merge decorative rubble while retaining structural names and exact triangles.
6. Current image accounting: embedded images occupy 95.43 MB; shared external files occupy 27.03 MB; unique image content across both occupies 86.40 MB. Repeated references to one external file are shared storage, not duplicate payloads.
7. Some objects depict the wrong thing. `itemIconAppearances.ts` maps coney foot to claw, boar bristle to hide and rat tail to horn; farm dressing uses a training dummy for a scarecrow and a barrel rack for a trough. Replace these explicit stand-ins with actual objects. Share item geometry between equipped gear and icons.
8. The 16 assets tagged placeholder-style remain in the catalogue. Audit their active uses, replace the geology/bridge/creature silhouettes that still ship, and retire unused entries. This is more useful than recoloring every file indiscriminately.

## Source and acceptance boundaries

Source-cache availability is not rechecked by this census. Historical source paths in the JSON identify the original review targets; they are not proof that those sources remain available or unchanged.

`model-audit.json` records retain/repair/replace and the reason for each model. A family inference is marked explicitly. Retain means no specific replacement is justified by this audit, not that the model is production accepted. Material roles, texture orientation, UV seams, joint deformation and world placement must be reviewed in the lab and authored locations. Optimized outputs remain under ignored `runs/local-model-rebuild/` until the root accepts and promotes them.
