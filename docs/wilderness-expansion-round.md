# Wilderness expansion round

The requested work is a gradual northern transition, more authored ruins and dead trees,
torch lighting and a local lava channel, completed fantasy creature art across the original
biomes, and denser encounters. Ordinary animals remain near the starting settlements.

The root booted the real game and production feature lab in Chromium before this round.
Both reported ready, with no browser errors. `game/src/contracts.ts` stays frozen.

## Ownership

- Root: shared registration, world terrain and biome fields, world placements, navigation,
  application wiring, acceptance and whole-game checks.
- Forest creature worker: `forestCreatureRedesigns.ts`, forest staging/generator and tests.
- Stone creature worker: `stoneCreatureRedesigns.ts`, stone staging/generator and tests.
- Ash creature worker: `ashCreatureRedesigns.ts`, ash staging/generator and tests.
- Tree worker: `tools/wilderness-trees`, tree staging, art and focused tests.
- Ruin worker: `wildernessRuins.ts`, ruin lab driver, design notes and tests.
- Effects worker: `wildernessEffects.ts`, `wildernessLava.ts`, effects driver and tests.
- Population worker: `biomePopulation.ts`, placement audit, plan and tests.

Workers do not alter another worker's files or the shared manifest. The root registers
staged candidates for the lab, reviews the rendered results, then promotes accepted assets
and activates their world placements. A source review or changed clip time alone is not
art or gameplay acceptance.

## World-authoring exception

The latitude blend, world-scale scatter, encounter distribution, roads and lava footprint
are authored world behavior and need full-world proof. Isolating these would remove their
spatial relationships. This exception does not cover tree geometry, creatures, ruins,
torch lighting or lava rendering. Those use the production feature lab first.

## Integrated result

The Wilderness now has eight authored ruin sites, four original deadwood models, fourteen road
braziers, native torches on the ruins and castle, and the Widow's Furnace lava channel. Its
population rises from 38 to 88. The seven measured northward transects have 90–185 m transitions
between 10% and 90% night. Terrain, palette, vegetation and sky use the same blended field.

Fifteen accepted regional creature designs replace all 54 ordinary nonstarter groups and the
bodies of seven original bosses. Twelve starter animal groups and five human bandit groups
remain. The 56 additional roaming packs contain 154 residents. Restored original group counts
and sixteen ruin haunts bring the core surface population to 509, an increase of 182. The
production coast adds 234 more residents. Original balance, quest progression, hunt credit,
trophies and boss identities survive the body changes.

The root accepted every creature cohort, tree, ruin and effect in the production lab after
motion/interaction checks and screenshot review. Fresh read-only critics reviewed the art.
The final Wilderness critic accepted the populated transition, all four ruin recipes, grove,
torch trail, lava banks and regenerated map. Ruin foundations exposed an inverse-rotation bug
in terrain-pad sampling; the corrected sampler now matches Three's world rotation and keeps
the full footprints level.

## Verification

| Check | Final result |
| --- | --- |
| TypeScript, production build, documentation build | Passed |
| Complete Vitest suite, four workers | 279 files; 2,104 passed, one existing skip |
| Combined production feature lab | Passed in 50.7 s; real movement, melee, magic and building controls |
| Wilderness transition, haunts, lava navigation and keyboard movement | Passed in 66.1 s |
| Focused final ruin retake | Passed in 33.0 s; all eight foundations/passages and complete drawn structure parts |
| Castle entrance, northern residents and mobile map | Passed in 38.4 s |
| Final added-pack navigation | 56 habitats, 224 dry anchors and 336 complete paths; no failures |
| New creature world integration | Passed in 50.0 s; all 154 added residents, all 54 ordinary remaps, three biome views and 390 px mobile views |
| Real mouse combat | Original `regional_gloam_fox_1`, now Heath Jack; health changed from 12 to 7 after the verified player click |
| Final cave integration | Passed in 33.6 s; real portal click, accepted Blind Cave Weaver bodies and resident paths |
| Regenerated map | 4800 × 5600; minimap 148,772 bytes; highest detail 794,136 bytes; all payload checks passed |

These browser runs reported no game, page or console errors. The population and new-creature
drivers also checked failed requests. Navigation was rebuilt from the final rotated pads,
ruins, habitat reservations and lava barriers, producing 3,372 polygons. The final map was
captured from the complete production scene, with full structure and scatter residency.

Screenshot readiness must include renderer compilation. A resident entity can have valid
drawn bounds while streaming warmup still suppresses its batch. Early empty ruin captures
were rejected. The final ruin retake waits for target part residency, drawn bounds and a
completed shader queue. Ecotone and grove captures also wait for every scatter tile within
120 m of the player. Later background tiles may enqueue new shaders after that checkpoint.

The final creature critic also accepted the desktop, mobile, combat and cave captures. The
three-body groups remain distinct, and the apparent height of the upper Flint Mandible was
checked against its live rig: its minimum sampled terrain clearance was about six millimetres.

Reproduce the final focused world checks with:

```sh
npx tsx tools/wilderness-expansion-world-test.ts
npx tsx tools/wilderness-expansion-world-test.ts --ruins-only
npx tsx tools/wilderness-world-test.ts
npx tsx tools/biome-population-audit.ts --browser --require-assets --url=http://127.0.0.1:4173
npx tsx tools/biome-creatures-world-test.ts
npx tsx tools/regional-refinement-world-test.ts --cave-only
```

Detailed art iterations stay in their focused cohort and environment lab tools. The cave-only
check avoids repeating the older eight-view regional matrix after the new creature-world check.
Screenshots and reports remain disposable under `test-results/`; the final ruin images are in
`wilderness-expansion-world-ruins/`, replacing the premature first captures in the broader run.
