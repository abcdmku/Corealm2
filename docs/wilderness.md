# Wilderness and creature direction

The September 10 direction combines grounded fantasy, high fantasy RPG creatures, and stranger wilderness inhabitants. Basic animals stay around Millfield, Marchfield, and the first riverbanks. The far north uses night lighting, dead trees, grey stone, low relief, undead patrols, and the Black Knight castle.

## Authored world

The Wilderness occupies the full northern band, x −350…350 and z 460…700. The world is now 700 × 900 m before its coastal collar. Ashford's east gate connects to Last Light by a road that clears the reserved northern encounters. This region has no friendly settlement; its respawn fallback is Ashford.

The visual boundary follows the existing warped, normalized biome field. A northward climate term establishes the geographic band; circular intents hold the castle, graves and petrified grove. Terrain, stone surface, scatter and atmosphere consume that same field. The semantic rectangle does not mask the rendered boundary.

The Black Knight castle has thick masonry curtains, corner towers, a rear keep, slate spires, a six-metre gate and an open combat courtyard. Its foundation uses one graded pad. The rear keep entrance is sealed scenery; the courtyard is accessible. Skeleton soldiers and archers guard the approach, with revenants inside. There is no new Black Knight boss encounter in this change.

The northern population is now 88 residents in 33 encounters. The original 38 undead and strange creatures remain, eight ruin haunts add 16 residents, and twelve roaming packs add 34. Skeleton soldiers and wraiths occupy the open ruin passages. Grave settings retain the production burial-shrine composition.

Eight sites use four new ruin recipes: broken watchtowers, roofless abbeys, ruined smithies and shattered aqueducts. Each has fractured masonry, an open route through the structure and native torch mounts. Smithies include hearths, chimneys, anvils and work floors. Four original deadwood models add hollow griefwood, windbent claws, crown oaks and fallen root plates, with branch geometry, bark grain and real cavities.

Fourteen road braziers connect the occupied clearings. Torch flames cast warm local light. Widow's Furnace cuts a lava channel through the eastern waste, with dark crust, rough banks, animated molten pockets and local light. Terrain, molten geometry and navigation share the same curved footprint. The dry banks are walkable; molten ground blocks movement and routes go around it.

The 10–90% night transition spans 90–185 metres on the seven sampled northward transects. Living vegetation gives way to deadwood while the ground cools to grey and the sky darkens. The terrain remains mostly flat with low hills. Rotated ruin pads follow their actual footprints; a corrected inverse rotation keeps the full foundations level.

## Creature work

- **Chalk Warden:** the complete native shale guardian, widened and lowered, with a new weathered chalk UV atlas and retimed native takes.
- **Hollow Bough:** the complete native mossback rig with its leaf canopy removed, a narrower and taller body, petrified bark UV atlas, and slower native takes.
- **Pallid Shade:** an elongated, translucent shroud using the native cloth textures. Idle, walk and run hover without foot cycling; attack and reaction takes retain their native poses and timing proportions.

The generator is `tools/build-creature-redesign.mjs`; its durable atlas inputs are in `art/creature-redesign/`. Source licenses and provenance remain in the manifest. These are derivatives of existing complete bodies, not new meshes modelled from scratch.

The subsequent creature round completes fifteen regional designs:

| Region style | Accepted designs |
| --- | --- |
| Woodland and marsh | Briar Harrow, Fen Crawler, Reed Strider, Thorn Maw, Heath Jack |
| Stone and cavern | Cairn Treader, Flint Mandible, Vault Custodian, Blind Cave Weaver, Scree Watcher |
| Ash and undead | Kiln Marrow, Slag Crawler, Cinder Penitent, Grave Lantern, Veil Reaper |

These combine rebuilt silhouettes, authored mesh additions and deformation changes with mapped wood, bone, stone, iron, slag and cloth. Their generators and durable atlas inputs live under `tools/biome-creatures/` and `art/biome-creatures/`. Existing source rigs and animations remain the starting point; timing, articulation and geometry were revised and tested in motion. They are not fifteen unrelated rigs modelled from scratch.

All 54 ordinary nonstarter groups in the original areas use these accepted bodies. Seven original bosses also use the new bodies while retaining their combat families, phases, rewards and identities. Twelve starter animal groups and five human bandit groups remain. Source models are available separately in the feature lab for comparison.

The 56 new biome packs add 154 residents. Together with the ruin haunts and restored original encounter counts, the core surface population rises from 327 to 509. The coastal generator adds another 234 residents. See [the population plan](./biome-population-plan.md) for regional counts and reservations.

`fantasyEncounters.ts` projects the authored occupants onto stable group IDs. Regional pack activation replaces remote natural wildlife while preserving existing fantasy assignments. Coastal generation excludes basic animal models. Original source bodies remain available under `source:` lab presets for animation regression checks.

The trap-line and Stone Cavern quests now count the new inhabitants. Save repair transfers earned kills and their stage baselines once, preserving progress through both roster revisions. Stable group aliases retain original balance, marks, all twenty-one expansion trophies and fox material. Existing hunt contracts continue to credit their remapped groups without crediting unrelated creatures that share a body.

## Acceptance and scope

The castle, creature derivatives, atmosphere and native deadwood were exercised in the production feature lab before world integration. The full-world exception covers the geographic extension, organic climate field, terrain, roads and scatter: their behavior depends on the authored island and cannot be proven in an isolated yard. Reused burial settings retain their existing lab proof.

Reproducible checks:

```sh
npx tsx tools/wilderness-lab-test.ts
npx tsx tools/creature-redesign-lab-test.ts
npx tsx tools/wilderness-foliage-lab-test.ts
npx tsx tools/wilderness-world-test.ts
npm run navmesh:build
npm run world-map
npm run typecheck
npm test
npm run build
```

Browser reports and screenshots remain disposable under `test-results/`. World acceptance checks actual resident counts, dry ground, complete navigation paths, a keyboard walk through the castle gate, normal/mobile maps, animal confinement, and browser/game errors.

The fifteen creatures, four original trees, four ruins and lava/torch effects passed their focused production lab checks and root/fresh-critic screenshot review before promotion. Final integrated browser results are recorded in [the expansion round](./wilderness-expansion-round.md).
