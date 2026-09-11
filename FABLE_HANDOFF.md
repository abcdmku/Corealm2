# Fable handoff — Wilderness expansion

Updated 2026-09-10. The user asked to wrap up and hand this work to Fable. Implementation is largely integrated; final acceptance is incomplete. Continue from this working tree rather than rebuilding the feature.

The repository is on `main` with substantial tracked and untracked changes, including the user's merged magic update. This wrap-up made no commit. Preserve the rune renames, existing edits, new GLBs, icons, tools and tests. A tracked-files-only patch will omit required assets.

The development server is running at **http://127.0.0.1:4173**; HTTP 200 was verified at handoff. Restart with `npm run dev` if needed. Current logs are `test-results/dev-server.log` and `test-results/dev-server-error.log`. Node 24 is required.

## Integrated scope

- Wilderness now spans z460–940, twice its former depth. z460–700 is T50; z700–940 is T70. Atmosphere gradually changes from grey moonlight to blue/violet magic. Plains, small hills, deadwood and living pockets are authored.
- Lava uses 21 channels and 13 pools, branching flows, irregular slag plates and a shared rendering/terrain/navigation authority. Deep flows become blue/purple.
- Eleven new creature bodies, including five rune keepers, and six dragon variants are promoted and registered. Shallow dragons are red, black and lava hatchlings; deep dragons are full red, black and purple adults. Rocky creatures have localized emitting openings; deep creatures have restrained blue/violet effects.
- Twenty-four additional Wilderness packs contain 225 ordinary residents, plus five singleton keepers. Ordinary pack counts are 7–15. The six new fortress court packs contain nine residents each.
- Seven original regional bosses now use dedicated bodies. Their computed levels are Galeskin 11, Tempest Roc 13, Mossbound 15, Rootheart 25, Tideworn 40, Ordrun 50 and Cinderwake 80. Stable group IDs, quest targets and Orb rewards are preserved. The level-gap regression below still needs review against ordinary creature levels.
- Five keepers use the merged spell update's rune IDs: Ashseal Warden/Mind (level 150), Furnace Regent/Chaos (200), Chainbound Archon/Death (210), Nightforge Marshal/Blood (280), Hollow Star/Wrath (350). Cosmic Runes supplement their drops.
- Three large occupied structures are active: Cinder Chain Foundry at [-210,735], Nightforge Bastion at [175,815], Hollow Star Sanctum at [-20,875]. They have production collisions, through routes, courtyards and mounted torches. Court drops supply unique crafting components.
- Six resource sites provide T50 Cindervein mining and living teak pockets, plus T70 Nightglass mining and Starwood/Moonvein magic trees. Ten resource model variants are promoted, including depleted states and stumps.
- Sixty-two Wilderness items and 49 recipes are registered, including T50/T70 equipment, tools, keeper rewards and progression materials. All 62 accepted icon master/game pairs were hash-verified and copied into `art/item-icons/256` and `game/public/assets/icons/items/48`.
- Dense Gravelmaw integration is complete: chamber one radius 13; six ordinary packs of seven; exact lab formations used as dungeon habitats. Underground habitats are excluded from surface dressing/tree clearances. Original actor IDs are preserved.
- Existing regional/coastal population changes and reset repairs remain integrated. Coast regeneration clears old AI state and rebuilds current habitats; navigation reservations retain the original constructed solids.

## Runtime fixes included

- Dungeon lintels carry `SolidVolume.elevated`, preventing a false downward navigation skirt from blocking open gates.
- Startup clamps negative animation-frame deltas; the simulation clock ignores negative/nonfinite advances. This fixed the dense cave's tick-zero freeze after a long shader warmup.
- Advanced spell preparation warms actual color, HDR glow and shadow paths, preallocates effect pools and initializes instance colors. `shaderPreparation.ts` handles custom depth hooks without Earth-material callback recursion. Temporary timing wrappers were removed.
- The real loot-to-spell lab passed, but its first Furnace Whip cast still had an 883.4 ms frame gap. This is not a zero-stall performance claim.

## Verification at handoff

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed |
| `npm run build` | Passed, including production content validation; bundle-size and ineffective dynamic-import warnings remain |
| `npx tsx tools/validate-game-content.ts` | Passed: 480 assets, 300 items, 191 recipes, 12,909 semantic entities, 102 route locations, seed 1337 |
| Last whole Vitest run | 2,338 passed, 17 failed, 1 skipped, 2,356 total; before final cave/icon integration |
| Final focused rerun after cave/icon integration | 58/58 passed across seven files |
| Remaining failing-file rerun | 69 passed, **15 failed** across twelve files; current failures listed below |
| Final dense cave Chromium lab | Passed in 23.65 s: 42 live residents, real movement, both gates block closed and allow passage open, no errors; screenshots inspected |
| Final authored northern road CPU checks | Passed: actual curved road widths and joins tested against production lava/banks |

Reports are `test-results/wilderness-final-tests.json`, `test-results/wilderness-handoff-focused-tests.json` and `test-results/wilderness-handoff-known-failures.json`. The whole suite was not rerun after the last integration; do not combine these into a claimed green whole-suite result.

### Fifteen confirmed remaining failures

The likely causes below are triage notes, not accepted fixes. Preserve meaningful assertions; do not merely loosen tests to obtain a pass.

| Test file | Failures / observed result | Next investigation |
| --- | --- | --- |
| `tests/audioCatalog.test.ts` | 1: 100 voiceless families versus expected 83 | Account explicitly for the 17 new creature/dragon families and their sound coverage. |
| `tests/creature-gait.test.ts` | 1: cadence ceilings exceeded for Galeskin, Rootheart, hatchlings, Cinderback, Rift Carapace and red adult dragon packs | Reconcile native stride, travel speed and playback rate. Red hatchling reaches 11.90 Hz at 4.68 m/s. Requires real motion review. |
| `tests/enemy-realm-isolation.test.ts` | 1: Ordrun slam leaves health 9976 versus expected 9979 | Ordrun's phase damage changed with level scaling; verify the expectation while retaining realm isolation proof. |
| `tests/guide-creatures.test.ts` | 1: expects `hollow_bough_t10` | Reconcile guide output with the creature's current placed tier. |
| `tests/item-icon-parity.test.ts` | 1: 12 hand items versus expected 8 | Update complete catalog coverage for the new hand equipment while retaining staging checks. |
| `tests/kilnhalt-expansion.test.ts` | 3: old world bounds, old four miniboss bodies/scale, old three Orb boss bodies | Align with north940 and the accepted dedicated boss bodies; preserve placement and rank assertions. |
| `tests/mining-access.test.ts` | 1: `cindervein_workings_resources_1` has 0.02905 m clearance discrepancy | Inspect the actual working position against new ore bounds and collisions. |
| `tests/navigation-shipped-artifact.test.ts` | 1: navigation source fingerprint mismatch | Bake only after placement/collision fixes are settled. |
| `tests/player-level-labels.test.ts` | 2: purple dragon label78 versus spawned77; regional miniboss3 versus ordinary10 | Fix label/stat consistency and review low-tier encounter progression. |
| `tests/resource-presentation-stability.test.ts` | 1: eight ores versus expected six | Include the two new ore types while retaining compact-placement checks. |
| `tests/wilderness-foundations.test.ts` | 1: Forgotten Forge corner differs by 0.09912 m, limit0.02 | Repair graded terrain support across the complete rotated ruin footprint. |
| `tests/world-sites.test.ts` | 1: four mining stance/equipment placement violations | Read the individual diagnostics and repair source site positions/clearances. |

## Remaining acceptance work, in order

1. Fix the confirmed failures, including real movement, mining, foundation and label issues. Verify production caller behavior before updating stale expectations.
2. Rebuild shipped navigation and maps. **Both are stale for the final north940 world**, even though old generated files are already dirty in this working tree. Do not treat those changes as final artifacts.

   ```powershell
   npm run navmesh:build
   npm run world-map
   npm run typecheck
   npm test
   npm run build
   npm run docs:build
   ```

3. Run the seven final-world bands separately, inspecting each report and its screenshots. The ready driver uses the real world; it does not activate hidden candidate content. Its setup and evidence limits are documented in `docs/deep-wilderness-world-gate.md`.

   ```powershell
   npx tsx tools/deep-wilderness-world-test.ts --band shallow
   npx tsx tools/deep-wilderness-world-test.ts --band deep
   npx tsx tools/deep-wilderness-world-test.ts --band structures
   npx tsx tools/deep-wilderness-world-test.ts --band resources
   npx tsx tools/deep-wilderness-world-test.ts --band mobile
   npx tsx tools/deep-wilderness-world-test.ts --band coast
   npx tsx tools/deep-wilderness-world-test.ts --band regions
   ```

4. Complete the active RPG pack lifecycle proof and final combined lab shards, separately:

   ```powershell
   npx tsx tools/regional-pack-lifecycle-test.ts --pack pack_fallowmarch_coldbrace_southwest_pack --budget-ms 120000
   npm run lab:test -- --shard combat
   npm run lab:test -- --shard building
   npm run lab:test -- --shard navigation
   ```

5. Verify the integrated full-world cave, not just its accepted compact fixture. Obtain fresh read-only review after fixes. Only mark asset `acceptance.worldIntegrated` true once actual world placement and screenshots pass. Several promoted assets deliberately retain false here.

Follow `AGENTS.md`, `docs/feature-lab.md` and `docs/world-authoring.md`. Root owns shared contracts and final checks; concurrent workers need disjoint file ownership. Serialize GPU/browser work. Keep focused jobs within 60 seconds and world/lifecycle jobs within 120 seconds. Acceptance cameras must remain achievable through ordinary grounded player-follow controls. Authored full-world terrain/layout is the recorded lab-first exception; reusable assets and local interactions still need lab proof.

## Code and evidence map

| Area | Main source / evidence |
| --- | --- |
| World extent and progression | `game/src/content/wildernessDepth.ts`, `wilderness.ts`, `wildernessExpansion.ts`, `wildernessEnemyProgression.ts` |
| Population and formations | `deepWildernessEncounters.ts`, `legacyEncounterPlacements.ts`, `encounterPopulation.ts`, `worldHabitats.ts`, `regions.ts` under `game/src/content/` |
| Creatures and dragons | `wildernessCreatureSpecies.ts`, `wildernessDragons.ts`, `regionalBossBodies.ts`, `fantasyEncounters.ts`; `game/src/render/wildernessCreatureEffects.ts` |
| Lava / structures / resources | `game/src/content/wildernessLava.ts`, `wildernessResources.ts`, `game/src/render/compositions/deepWildernessStructures.ts`, `game/src/world/siteTerrain.ts` |
| Loot and equipment | `game/src/content/wildernessLoot.ts`, `wildernessEnemyProgression.ts`, `game/src/render/equipmentVisuals.ts`, `itemIconAppearances.ts` |
| Eleven final creature proofs | `test-results/wilderness-creatures/acceptance-index.json` |
| Six final dragon proofs | `test-results/wilderness-dragons/final-proof-index.json` |
| Seven regional boss proofs | `test-results/regional-bosses/lab-acceptance-summary.json` |
| Dense cave | `test-results/dense-cave-lab/acceptance-summary.json`; `game/src/featureLab/denseCave.ts` |
| Loot, craft, equip, rune spending | `test-results/wilderness-loot-lab/report.json`; `docs/wilderness-loot.md` |
| Icon promotion | `test-results/wilderness-icon-review/review.json` and `promotion.json` |

The creature and dragon indexes distinguish full-motion evidence from later material-only retakes. Dragon combat evidence establishes incoming damage; outgoing attack/contact synchronization has not been established. Equipment browser coverage used the male player rig; female coverage is currently CPU-based. The loot lab deliberately wounded the keeper to one current HP, so it proves death, pickup and rune spending, not full boss difficulty. Some keeper equipment still reuses base silhouettes with material changes.

Disposable `test-results` reports and screenshots are local and ignored. If Fable runs elsewhere, transfer that evidence separately or regenerate it from the retained tools and sources. Older round notes and the dragon worker's final “ready for promotion” sentence predate root integration; the six dragons, eleven creatures and seven regional bosses are now promoted. This file records the handoff state, not a claim of final gameplay acceptance.
