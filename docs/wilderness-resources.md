# Wilderness resources

`content/wildernessResources.ts` proposes two T50 teak groves, two T70 magic groves and one worked mine in each depth band. It follows the six frozen reservations in `wildernessDepth.ts`. Each mine has seven deposits in an open aisle below one connected cut face. Each grove has nine trees in unequal crescent rows, leaving an eight metre half-width through the middle. Shallow groves include a little living understory protected by a rock windbreak.

The new ore resources yield `cindervein_ore` and `nightglass_ore`. Their definitions have explicit extracted models, capacities and cooldowns. The progression module supplies the ore items and equipment recipes. Teak and magic trees retain the existing `teak_log` and `magic_log` yields, with requirements 50 and 70. The authored grove resources select only the Wilderness tree variants. Their species aliases use the same Wilderness resource definitions for scattered forest harvesting, so both paths use the authored slender teak and heavy magic stumps.

The tree build derives from the accepted native branch hierarchies. One smooth deformation moves wood and attached leaves together. T50 trees retain whole leaf sprays on their sheltered side and expose scorched wood toward the fire. Local charcoal scars have uneven edges along the lower bole. Two dead boughs grow from collars below the living crown and end in unequal torn splinters. Their two forms have different age, lean and crown shape. The old starwood spreads into broad low forks; moonvein has a rising twisted crown. Both retain the native leaf cutouts, bark scan and UVs. Blue or violet sap occupies recessed channels cut into the wood surface along its branch UVs. The native species' leaf shimmer remains active; their added sap emission stays on rigid wood.

The depleted stumps retain the actual lower bole and buttress roots of the living Lastroot and Starwood models. They keep the same embedded bark texture, UV coordinates, colours and production bark relief. An uneven cut surface closes the exact bark rim with concentric growth rings. CPU validation compares the living and depleted root contacts and bark texture hashes.

The ore build uses the production ground-ore generator's six connected fracture masses and recessed mineral surfaces. The two families change fracture proportions and shear, colour and emission. Available and extracted states use the same deformation, rooted footprint and outer envelope. Ground normals are transformed with the geometry. The original granular normal map stays in the GLB. A lab revision restored source fracture colour variation in the hosts and reduced flat mineral emission and sharp highlights.

Build candidates with `npx tsx tools/wilderness-resources/build.ts`. Output is staged under `test-results/wilderness-resources/catalog.json`; the build does not modify the production manifest. The catalog records source model hashes, generator provenance, measured dimensions, triangle counts and texture origins. Its pack uses `LicenseRef-Corealm-Original`. The root must add its accepted generator source to the existing original-asset provenance allowlists when promoting it.

Root integration hooks:

- Register `WILDERNESS_ORE_RESOURCES` and `WILDERNESS_TREE_RESOURCES` in the resource catalog, and native tree aliases from `WILDERNESS_TREE_VARIANTS` in `treeSpecies.ts`.
- The root has wired native aliases, resource presentation selection and proposed site lookups into the environment workbench. Candidate mines use the same `buildWorldSiteDressing`, `buildMineCutFace`, mining access and semantic view paths as production.
- After lab acceptance, register the proposed locations, clusters and sites in the Wilderness and `WORLD_SITES`. Connect roads to their south-facing approaches. Mine half-extents are 23 by 25 metres; grove half-extents are 23 by 23 metres. Packs, lava and scatter must reserve the full footprints.
- Use the measured trunk radius from the promoted catalog for tree collision. The original species aliases preserve harvest items and saving semantics.

Focused source checks are `npx vitest run tests/wilderness-resources.test.ts`. The ten checks passed during development. They cover complete resource/slot links, progression bands, clear approaches, timber identities, rooted sculpts and transformed normals.

`npx tsx tools/wilderness-resources/validate.ts` also passed geometry checks for all ten GLBs. It checks actual exported attributes, normals and triangles; exact ore ground-contact correspondence across extraction; zero spent-state emission; and a small sap fraction of the magic tree wood.

The root schedules three separate browser jobs, each with a hard 59 second deadline:

```
npx tsx tools/wilderness-resources/lab-test.ts --trees
npx tsx tools/wilderness-resources/lab-test.ts --mines
npx tsx tools/wilderness-resources/lab-test.ts --groves
```

The tree job checks actual detailed colour submissions near, far and on return; records wood-only and night views; and preserves the source geometry at distance. Mine and grove jobs use real pointer hover/click, natural gathering and inventory receipts through depletion. Candidate GLBs enter through the production loader. All camera poses move the actual grounded player and stay within the interactive pitch and 11 metre zoom limits. They never detach the camera or raise its target.

The final ore and magic living-tree captures use settled lighting. The complete tree job passed in 29.55 seconds with 24 images, mines in 33.89 seconds with six images, and groves in 37.42 seconds with four images. Mining delivered five cindervein ore and four nightglass ore through real clicks and natural depletion. The grove run delivered six teak logs and five magic logs. Root fixed the candidate-content lookup in mining access and an empty `Object3D.add` call discovered by the grove fixture.

Root and critic review accepted the revised ore hosts and living magic trees provisionally. They requested clearer fire damage on the teak and textured stumps that match the living roots. Those four revised assets passed a focused T50 tree retake in 16.64 seconds and a grove retake in 38.00 seconds. Reports are `test-results/wilderness-resources/lab-trees-t50/report.json` and `lab-groves/report.json`, with twelve and four images. Both reports match the current catalog's SHA and byte count for all ten candidates. The new daylight approaches show blackened torn boughs below living crowns. Both depleted stump images show the bark grain and original root flare. Natural gathering again yielded six teak logs and five magic logs, and the rooted entity positions remained unchanged. These captures supersede the earlier teak and fitted-oak stump images. Root retains final visual acceptance and promotion. Final mine terrain embedding, placement, roads, navigation and forest residency remain a separate authored-world check after promotion.
