# Biome creature population

The integrated population adds 56 small encounters and 154 residents. Each pack has two or three creatures. Eight packs fill the remote Fallowmarch approaches. Each other biome gains twelve packs spread across its southern, middle and northern ground. Eight northern ruins also receive sixteen additional haunting creatures.

The counts below include the activated regional pack catalogue, whose production resolver reduces some wildlife formations. Its Fallowmarch population is 95 residents. The raw source catalogue's 104 members is not the live count.

| Region | Core before the 56 new packs | New pack residents | Integrated core residents |
| --- | ---: | ---: | ---: |
| Fallowmarch | 169 | 22 | 191 |
| Vellenwood | 55 | 33 | 88 |
| Karrowmoor | 44 | 32 | 76 |
| Kilnhalt | 33 | 33 | 66 |
| Wilderness | 54 | 34 | 88 |
| Total | 355 | 154 | 509 |

The prior production core had 327 residents. Removing the previous fantasy projection's count caps restores twelve residents: nine in Vellenwood, two in Karrowmoor and one in Kilnhalt. The sixteen ruin haunts bring that baseline to 355 before the 154 pack residents are added. The integrated core therefore gains 182 residents, about 56% overall. Fallowmarch already has a large activated population, so its increase is smaller and stays outside the starting fields. These counts exclude the dungeon and coastal generation. The production coastal generator still adds 234 residents, with no ordinary animal bodies.

## Creature coverage

`BIOME_POPULATION_LEGACY_REPLACEMENTS` in `game/src/content/biomePopulation.ts` covers all 54 ordinary creature groups in the original areas outside the starting grounds. Every group now uses one of the fifteen new regional species. All fifteen assets have passed the root's isolated lab acceptance and are promoted to the public manifest. This includes replacement bodies for Hollowroot Spider, Quarry Nightmare, Cinder Ravager, Basalt Drake and Gorge Mantis.

The original content has 78 groups including Stone Cavern. Twelve starter animal groups and five human bandit groups remain intentional exceptions. The seven bosses also have integrated replacement bodies, bringing the original-area total to 61 changed groups. Their combat families, rewards, quest keys and saved identities remain intact. Those IDs are `tempest_roc`, `galeskin`, `rootheart`, `mossbound`, `tideworn`, `ordrun` and `cinderwake`. The original source gallery remains available for comparison.

The 54 ordinary encounters keep their original group IDs, tiers, resident counts and combat balance. Stable stat aliases retain their original drops and Marks while taking the new family's name and rig movement speeds. All 21 displaced expansion trophies, plus fox crafting material, remain obtainable for existing recipes. The seven bosses retain their Orb and rare equipment drops and Ordrun's phase thresholds. New roaming packs use regional combat tiers: 1 in Fallowmarch, 5 in Vellenwood, 10 in Karrowmoor and 20 in Kilnhalt and the Wilderness.

Saved active hunts accept kills from the replacement of their original or previous fantasy occupant. Compatibility follows each encounter's recorded predecessors and retains region, player-credit, death and serial checks. Saved progress and rewards are preserved. Wilderness hunt saves and the affected story-quest family migrations are integrated.

The audit resolves the active regional catalogue and runs the coastal generator through `buildWorld`. Its integrated census finds no ordinary animal leaks in projected core groups, active regional packs or the 234 coastal residents. The coastal candidate pool now uses the production fantasy roster. Existing goblin and skeleton packs remain alongside the new regional creatures.

## Placement

Every new habitat is a 9 m disc. Its four ordered activity anchors form a 5.25 m circuit. The first two or three anchors are the spawn positions, leaving at least 7.4 m between residents. This reserves a moving horizontal radius of 3.5 m, including body scale and animation. The promoted asset check passes for all seventeen species used by these packs: the fifteen new species and two existing Wilderness creatures. Its largest conservative envelope is the Flint Mandible at 3.35 m.

The source audit uses the production graded heightfield, resolved road curves and solved water contours. It samples the entire habitat floor on a 2.5 m grid and rejects wet points or slopes over 0.65 rise/run, about 33 degrees. It reserves existing habitat body envelopes, active regional packs, settlements, resource sites, landmarks, clusters and eight metres around resolved road centrelines. Each accepted disc leaves at least a further metre beyond those reservations. New pack discs remain more than two metres apart, including across region seams.

Wilderness reservations include the 46 by 52 m castle, the lava section around x 120 to 245 and z 640 to 700, and eight accepted ruins: two watchtowers, smithies, abbeys and aqueducts. The Silent Stones pack sits at `[-50,635]`, clear of the northern smithy. The Petrified Grove south pack sits at `[280,574]`, clear of the eastern aqueduct. No dressing is placed inside the new habitat circuits. The new groups and habitats are registered in production, where the habitat catalogue also supplies tree-clearance paths.

The regional-pack exclusion test keeps all 96 source plans checked against the original habitat reservations. New accepted habitats are checked against the activated production catalogue, including its assignment overrides and native dressing. Unactivated source plans do not reserve occupied space in the shipped world. Roads, water, resource sites, settlements, landmarks, entrances and dungeon constraints remain checked.

This work uses the documented full-world placement exception because it authors encounter distribution over the actual terrain. It does not bypass the separate lab gate for creature models, animations, trees, effects or ruin structures.

## Verification and final acceptance

`npx vitest run tests/biome-population.test.ts --maxWorkers=1` checks original creature coverage, additive identities, each biome's population increase, body clearances, starter exclusions, pack separation and the reserved lava area. The focused population tests pass. `tests/regional-pack-exclusions.test.ts` passes all eight source and active-world reservation tests. The reward and hunt checks in `tests/fantasy-encounter-rewards.test.ts` and `tests/hunt-contracts.test.ts` pass all nineteen tests.

`npx tsx tools/biome-population-audit.ts` writes the source census, every source-to-projected group comparison, active regional occupants, production coastal population and the terrain reservation report under ignored `test-results/biome-population/`.

`npx tsx tools/biome-population-audit.ts --browser --require-assets --url=http://127.0.0.1:4173` additionally probes the real game's navigation and requires the promoted bodies. The final integrated world passed all 224 dry anchors and all 336 pairwise paths after the rotated-foundation correction and navigation bake, with no game, browser console or page errors.

`npx tsx tools/biome-creatures-world-test.ts` passed in 50 seconds. It checked every added resident and all 54 ordinary original remaps in the live game, captured three regional packs and a 390 px mobile view, and used a verified mouse click to damage an original encounter's Heath Jack. The separate cave check crossed the real portal and verified the replacement Blind Cave Weavers. See [the expansion round](./wilderness-expansion-round.md) for the combined checks and final evidence locations.

The asset check uses measured horizontal bounds relative to the model origin, world scale, the largest actual regional tier silhouette used by each species, a 20% motion reserve and 0.25 m extra clearance. The report is `body-envelopes.json`. All seventeen production population species fit the 3.5 m limit.

`resolveBiomePopulation(CREATURE_SPECIES)` is integrated in the region roster, and `BIOME_POPULATION_HABITATS` is integrated in the habitat catalogue. The resolver throws on a missing species, preventing a silent placeholder substitution. Final acceptance includes screenshots of the populated production biomes at the normal play camera, actual combat and a mobile view. Navigation checks alone do not establish those results.
