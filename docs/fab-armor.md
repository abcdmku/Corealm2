# Fab armor sources and conversion

This document records source identity, screenshot matching, and the local conversion workflow. It does not establish final gameplay or visual acceptance. The root agent owns that evidence under [the feature-lab workflow](feature-lab.md).

## Local source packs

The user acquired these packs through Fab and supplied the Fab Standard License terms for the work. Their local download root is `C:/ProgramData/Epic/EpicGamesLauncher/VaultCache`.

| Directory | Pack | Source format used |
|---|---|---|
| `ParagonGreystone` | Epic Games, Paragon: Greystone | Unreal assets under `data/Content/ParagonGreystone` |
| `ParagonKwang` | Epic Games, Paragon: Kwang | Unreal assets under `data/Content/ParagonKwang` |
| `LowpolyM1da6d6f97a10V1` | Polytope Studio, [Lowpoly Modular Armors Free](https://www.fab.com/listings/d32023d6-cc7c-4a6b-bbc6-b0821c3d3391) | Original FBX meshes and PNG masks under `data/Content/Polytope_Studio/Modular_Armors` |

Licensed source packs and intermediate exports stay in ignored, private `.asset-cache/fab-armor`. The export workflow copies the Paragon content into an isolated Unreal project and does not modify VaultCache. Acquiring or staging these sources is not permission to redistribute the packs as standalone assets. Preserve acquisition and license records with the project; distribute incorporated game assets according to the applicable license.

## Confirmed reference variants

Positions count from left to right in the user-supplied screenshots. Source demo-map actor positions confirmed the lineup after initial filename-based guesses proved incorrect.

| Greystone position | Variant | Selection |
|---|---|---|
| 1 | Tough | T70 rare melee boss armor |
| 2 | Novaborn | T50 rare melee boss armor |
| 3 | Base Greystone | Unselected |
| 4 | WhiteTiger | T90 rare melee boss armor, with TigerHelm |
| 5 | Dragonlord | Unselected |

| Kwang position | Variant | Selection |
|---|---|---|
| 1 | Sunrise | Unselected orange variant |
| 2 | Rosewood | T50 rare mage boss armor, teal cloth and bronze source trim |
| 3 | Frostwalker | T90 rare mage boss armor |
| 4 | GDC | Unselected purple variant |
| 5 | Albino | T70 rare mage boss armor, black and silver source variant |
| 6 | Manbun | Unselected |

The T50 mage adaptation uses leather and fabric in place of the source's metallic appearance. Higher-tier source ornamentation remains the basis for the selected sets.

Craftable mage armor uses the lowpoly male and female `Armor_05_C` outfit from the first screenshot at T1, T5, T10, T20, T50, and T70. The original modular FBX body, legs, helmet, gauntlets, and boots supply the five equipment slots. Generated materials distinguish the crafting tiers.

## Private exports and historical filenames

The exporter runs the installed Unreal Engine 5.8 with PythonScriptPlugin and GLTFExporter. It exports LOD0 skin weights and baked materials to `.asset-cache/fab-armor/paragon`. Each report row records its exact Unreal asset path and source material names.

| Final selection | Private GLB filename |
|---|---|
| Melee T50, Novaborn | `melee-t50-novaborn.glb` |
| Melee T70, Tough | `melee-t50.glb` |
| Melee T90, WhiteTiger | `melee-t90.glb` |
| WhiteTiger helmet | `melee-t90-helmet.glb` |
| Mage T50, Rosewood | `mage-t50-rosewood.glb` |
| Mage T70, Albino | `mage-t70.glb` |
| Mage T90, Frostwalker | `mage-t90.glb` |

Historical filenames remain unchanged to preserve provenance. `melee-t50.glb` contains Tough, which belongs at T70. `melee-t70.glb` contains unselected base Greystone, and `mage-t50.glb` contains unselected purple Kwang GDC. Use the selection mapping rather than guessing from these filenames.

The authored TigerHelm is a separate static actor, not a socket attachment. Relative to the WhiteTiger actor, its Unreal-space location is `(0, -1.365936, 185.326797)` centimeters, its rotation is zero, and its scale is `(1.060008, 1.139937, 1.100383)`. The adapter reconstructs this placement before binding the helmet to the host head.

## Reproduction commands

Run from the repository root. [export-unreal.ps1](../tools/fab-armor/export-unreal.ps1) stages the isolated project and starts Unreal hidden; [export_unreal.py](../tools/fab-armor/export_unreal.py) performs the native export and inspection.

```powershell
& tools/fab-armor/export-unreal.ps1 -NoLaunch
& tools/fab-armor/export-unreal.ps1 -AssetName melee-t50-novaborn
& tools/fab-armor/export-unreal.ps1 -AssetName mage-t50-rosewood
& tools/fab-armor/export-unreal.ps1 -InspectOnly
& tools/fab-armor/export-unreal.ps1 -InspectKwang
```

Wait for the returned process ID to exit before launching another command against the isolated project. Inspect `unreal/export.log` and `paragon/export-report.json`. `finished.txt` marks script completion, not successful export. Running without a selection exports all listed candidates, including historical unselected variants.

The inspection modes write `paragon/attachment-inspection.json` and `paragon/kwang-map-inspection.json`. These local reports retain the demo-map actor names, mesh paths, and transforms.

[convert-lowpoly.ts](../tools/fab-armor/convert-lowpoly.ts) imports and retargets the original modular FBX parts. [convert-paragon.ts](../tools/fab-armor/convert-paragon.ts) applies the confirmed selection mapping and adapts the Paragon exports to the host rig. Its [adaptation notes](../tools/fab-armor/paragon-adaptation.md) describe whole-component equipment assignment, source face and weapon removal, bone transfer, UV handling, and material roles.

```powershell
npx tsx tools/fab-armor/convert-lowpoly.ts --all
npx tsx tools/fab-armor/convert-paragon.ts melee-t50
npx tsx tools/fab-armor/convert-paragon.ts melee-t70
npx tsx tools/fab-armor/convert-paragon.ts melee-t90
npx tsx tools/fab-armor/convert-paragon.ts mage-t50
npx tsx tools/fab-armor/convert-paragon.ts mage-t70
npx tsx tools/fab-armor/convert-paragon.ts mage-t90
npx tsx tools/fab-armor/prepare-textures.ts
```

## Generated texture provenance

Original generated texture sources live in [art/fab-armor/textures](../art/fab-armor/textures): `fabric-tiers-generated.png`, `leather-generated.png`, `silk-70-generated.png`, and `scales-generated.png`. [provenance.json](../art/fab-armor/textures/provenance.json) records the generation method, date, and tier list. These original fabric and leather designs were generated without reference images; they are separate from the licensed pack textures.

[prepare-textures.ts](../tools/fab-armor/prepare-textures.ts) extracts the tier swatches, prepares 512-pixel runtime images, and uses the dedicated silk source for T70. Native source UVs and materials remain identifiable through the conversion reports.

## Generated inventory artwork

The owner requested illustrated icons instead of ordinary armor thumbnails. All 57 affected equipment pieces have separate original images from built-in `image_gen`, with actual transparency. [The prompt set](../art/fab-armor/icons/prompts.json) describes each garment and tier palette; per-set `result.json` files record exact prompts, source hashes and visual/alpha reviews. The illustrations depict empty garments, handwear and footwear and follow the imported sets' material identities.

Frostguard's five item icons were regenerated after the owner rejected the cat/tiger design. Their new T90 Aurora artwork uses human knight plate shapes, midnight-blue steel, silver edges, fine gold engraving and teal/violet enamel. The helmet has a straight visor and rounded crown; the set has no animal faces, ears, fur or claws. These icons follow the revised art direction independently of the equipped 3D models. Originals and exact prompts are in [frostguard/result.json](../art/fab-armor/icons/frostguard/result.json).

`npx tsx tools/fab-armor/icons.ts` stages 256-pixel masters and 48-pixel inventory derivatives for review. After the root reviews the contact sheet, `--accept` updates the published icons and generated-art registry. The script preserves previous registry/source files in private `.asset-cache/fab-armor/icons-previous`. Originals remain in `art/fab-armor/icons`; their alpha is preserved during normalization.

Magic armor uses a slow, view-dependent teal/violet interference finish, increasing with tier. Rare armor names and rendered finishes identify T50 as Chitin blue, T70 as Void violet, and T90 as Aurora. Both melee and magic follow that palette. Aurora melee also receives animated iridescence. Exposed skin, hair and fur retain their source materials. Rare mage outfits use the dedicated native-UV finish described below. Saved item IDs and drop probabilities remain unchanged by material corrections.

## Acceptance boundary

Unreal reported some overlapping or degenerate bake UVs and fallback handling for skin, hair, and eye shading. A completed export or valid skin weights cannot prove material fidelity, helmet fit, animation quality, or equipment behavior. Converted candidates require the production feature lab, browser state checks, and screenshots from normal gameplay controls before final-world acceptance. Generated reports and screenshots remain disposable unless the root explicitly promotes them as durable evidence.

## Richer armor materials

Rare tier dye now preserves authored warm trim, silver highlights and dark backing instead of replacing all texture color with a single hue. Chitin keeps blue main panels; Void retains violet plates with contrasting ornament; Aurora retains its teal/violet interference. Magic shading no longer lifts every dark texel to a fixed brightness, and warm trim resists the animated color wash.

The generated indigo brocade experiment is retained as unused artwork at `art/fab-armor/textures/ornate-weave-provenance.json`. It is no longer applied to rare mage outfits: their projected detail UVs introduced stretched triangular patterns.

## Rare mage cloth construction

The rare mage outfits use fitted cloth tunics, rounded long sleeves, pleated robe skirts, woven sashes, soft gloves/cuffs, and simple boots. T50 has a calf-length robe, T70 adds asymmetric stoles, and T90 has an ankle-length robe, rounded embroidered shawl, and violet rear lining. T50/T70 retain the selected Kwang fabric drapes and headwraps. Their rigid chest, shoulder, hand and shin components are removed. Aurora's old pointed rear drape is replaced with a rounded panel that shares the robe's folds and skinning.

`fabMysticCloth.ts` shades authored outer cloth, lining, embroidery, bindings and soft leather independently. All use zero metalness. `fabMageArmor.ts` remains the native-map path for retained headwraps. Original normals survive on retained drapes; new garments use smooth geometry folds and continuous UV0. Imported gloss masks and projected UV1 are not used by the new cloth.

The tailored branch in `fabMagicSurface.ts` colors reflected sheen without animating the cloth's diffuse color. Anisotropic silk, narrow-range interference, and brighter thread highlights respond to real lighting and camera angle. Specular and sheen contributions are compressed before tone mapping so a folded sash cannot lose its pattern in a white flash. Clones preserve the branch and shader composition. `fab-mage-armor.test.ts` guards native mapping, inherited gloss removal, texture uniforms through cloning, and the reflected-light shader path.

The lab's `--mystic` verifies that staged cloth reaches the production cloth shader. `--motion-review` adds ten walking captures; `--material-review` adds eight normal camera angles at fixed material time. `--portraits` saves a crop of the normal front camera capture without changing camera limits or focus. The world verifier accepts `--mage-tier 90 --mage-only` for a focused equip/save check.

`convert-mystic-cloth.ts` stages the garments under `.asset-cache/fab-armor/mystic-cloth`. It reuses native fitted peasant clothing from the existing Modular Character Outfits Fantasy pack, preserves the production skeleton, and authors the robe/sleeve/shawl surfaces. The fitted Kwang source files remain untouched. After root lab acceptance, `npx tsx tools/fab-armor/catalog.ts --mystic --promote` installs the accepted variants under their existing equipment asset IDs. Item IDs, tiers, stats, recipes and drops do not change.

## Embroidered mage textiles

Three original 1024-pixel WebP fabrics are used from `game/public/assets/textures/fab-armor`: `mage-chitin-jacquard`, `mage-void-damask`, and `mage-aurora-brocade`. Chitin combines cobalt/teal scallops and gold stitching; Void uses indigo, plum and wine feather damask; Aurora uses teal/violet ribbons and pearl/gold embroidery. Large designs sit on sashes, hems and stoles, with restrained detail on main robe panels. Muted warm bindings and contrasting lining provide separate color areas.

Textiles sample continuous raw UV0 independently of source atlas crop transforms. Mirrored repeat avoids hard image-boundary seams, and mipmaps with anisotropic filtering retain stable detail during movement. Frostwalker's original hanging-cloth albedo depicts chainmail and rust; it no longer supplies cloth color. Native normal maps retain the actual folds and hems.

Built-in ImageGen produced each textile separately from text-only prompts. Originals, exact prompts, runtime paths and SHA256 hashes are recorded in [mage-textile-provenance.json](../art/fab-armor/textures/mage-textile-provenance.json). Existing illustrated inventory icons were not regenerated for this material revision.
