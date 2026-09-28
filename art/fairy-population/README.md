# Fairy creature textures

The fairy roster uses twelve ordinary forms in Gloamgarden and Faeholme. The frog, snail and hart are the permitted animal bases. Current body files and artwork provenance live in `game/public/assets/manifest.json`. Several forms and guardians have replaced the original studio bodies, so the historical `source` values in the form tables do not identify their current geometry or UVs.

Each finished regional skin uses image-generated colors, markings and material detail. Flat monochromatic recolors are not accepted. `textures/generated/` and its adjacent prompt records retain the original regional artwork. Replaced bodies record their current texture files in `sourceProvenance`; applying an older atlas to those bodies is invalid.

`npx tsx tools/fairy-population-assets.ts` verifies the current published variant, the tracked PNG hash and its embedded material bindings, then stages the published GLB bytes under `test-results/fairy-population/assets/`. It retains the current geometry, UVs, skinning, clips, alpha and PBR maps exactly. The command reports bodies that no longer own the historical atlas. Selecting one explicitly with `--only=<assetId>` fails rather than restoring its retired body. Each run writes only its selected, verified entries into the review catalog.

This command re-stages existing artwork. New artwork requires a UV review of the current body and a coordinated update of its texture provenance and pinned family source, so a later motion rebuild retains the skin. Creature rig and animation rebuilds use `tools/tripo-creatures/repair.ts` and its family profiles.

Review isolated bodies and every regional look in the [devdocs Art workspace](../../docs/feature-lab.md#asset-testing-in-devdocs). Install `test-results/fairy-population/assets/candidates.json` with the documented `viewer:preview-catalog` event, then open `#/art/creatures/<assetId or creatureId>`. Inspect Idle, Walk, Run, Attack, Hit and Death, the attack contact, held corpse and return to Idle. Compare motion with the native studio references and record a verdict. Screenshots remain disposable unless deliberately promoted as durable acceptance evidence.

The existing spacing check is for local population interactions after asset review:

```powershell
npx tsx tools/fairy-population-spacing-test.ts --url http://127.0.0.1:4173
```

It checks body clearance, movement and reset in the feature lab. It does not accept isolated creature art.
