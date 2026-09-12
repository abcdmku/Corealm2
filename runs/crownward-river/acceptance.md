# Crownward river acceptance

Crownward now blends directly into Wilderness over a broad northern ecotone. Numerical sampling preserves the existing authored biome cores and coastal coverage while rejecting any third-biome winner across the eastern north boundary. The western blend is also broader.

Crownmere is a large inland lake connected to Pearlwater, a descending river to the sea. Carving, surface geometry, wet-ground sampling, navigation exclusion and dressing clearance share the same channel shape. Two Quaternius CC0 arched timber bridges cross the river about 135m apart. Their exact source geometry supplies deck, rail, physics and camera collision. Fixed bank pads join the deck ends and roads cross through the bridges.

The eastern Wilderness gains four lava flows and six weathered volcanic hills with 23?28m crowns. Regional relief amplitude rises from 5.5 to 12. Existing creature and structure assets remain reused. Crownward has two red and two black whelp minibosses and one adult red dragon boss, reusing existing meshes and animations with T40 encounter stats.

## Accepted production lab

- test-results/crownward-river/bridge/report.json passes. The arched midpoint rises 3.8m over the banks. Keyboard traversal in both directions follows the elevated deck; submerged riverbed is excluded from navigation. The dry-bank overview was inspected using the normal 11m camera limit.
- test-results/crownward-river/dragons/report.json passes. All three production variants render, use the correct boss/miniboss rank, and lose health after normal attacks. Dragon views were captured from ordinary player positions, with normal camera limits.
- Only after these lab checks were the river and bridges registered in the final world and dragon encounters placed. The larger authored terrain/layout work uses the recorded world-authoring exception.

## Full world

Root inspected the lake, both bridges, added lava/hills and adult dragon placement. Both bridge crossings passed keyboard movement. Source review found and corrected river semantic masks, road grading bank preservation, ocean overlap ownership and lake-only scatter consumers.

TypeScript and 30 focused tests across 7 files pass. Content validation passes with 713 assets and 15,559 entities. Generated release/map results are appended after the final bake. Prior unrelated creature/cave/habitat test failures remain documented in runs/fairy-expansion/acceptance.md and are not claimed fixed here.

Bridge primary source and CC0 license: https://poly.pizza/m/j4KsIuJYnq . Reproducible staging, original source hashes and source geometry preservation are recorded in tools/crownward-bridges/provenance.json.

Final map review caught a lake-outlet gap caused by cross-section ribbons not covering the carved capsule footprint. The production surface now clips a shared grid against the same sampled footprint, with a geometry-raycast regression covering the outlet and lake interior. Conservative local wet masks also cover rounded banks, while dry terrain and raised decks retain navigation. The corrected bridge lab passed again. The river reaches ocean elevation inland of the coast, removing the raised square water extension. The regenerated 6600px map and shoreline detail were inspected successfully.

The final production build passes: 336 world tiles, 81.01 MB compressed. All 15 release-world, shipped-navigation and map-payload artifact tests pass. Development server remains available at http://localhost:4179.

Packaged-game acceptance at http://127.0.0.1:4180 passes after the final bake. Both bridges passed keyboard crossing on shipped navigation. Final lake, bridge, river-mouth, volcanic relief, lava and red-dragon screenshots were inspected with the normal player-follow camera. No game, browser-console or page errors were reported.
