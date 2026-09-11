# Regional boss bodies

Seven staged hero bodies preserve the existing encounter IDs, quests and orb drops. `game/src/content/regionalBossBodies.ts` exports the body mapping and isolated candidate species. Root owns final registration and balance integration. Candidate stats use `tuneEnemyCombatLevel` and `REGIONAL_BOSS_LEVELS`. The candidate scale cancels `tierSilhouetteScale` so the lab shows authored metres; root compensates world rank and tier scaling.

| Saved encounter | Authored body |
| --- | --- |
| `tempest_roc` | Three swept carapace shields, a crescent shovel cranium and curved stone mandibles |
| `galeskin` | Split timber mantle, open wind-cut head and a heavy root forearm |
| `rootheart` | Hollow cathedral trunk, load-bearing arches, recessed heart chamber and shoulder boughs |
| `mossbound` | Interlocking pod valves, feeding chamber, separate lower jaw and thick shoulder pods |
| `tideworn` | Low wave-eroded back shelves and an asymmetric split crushing claw |
| `ordrun` | Rebuilt twin-vault torso, gate head, broken lintels and masonry fists |
| `cinderwake` | Fused slag mantle, recessed barred furnace, iron face and hammer forearm |

The build uses the accepted Flint Mandible, Briar Harrow, Thorn Maw, Vault Custodian and Kiln Marrow rigs. It reshapes source vertices and bind joints together, replaces body sections, and binds all new anatomy to the same skin. Edited torso and head tracks accompany slower weight-bearing action cycles. The two tree bosses have shortened finger chains so planted feet support the body instead of the hanging fingertips setting its ground height.

New wood and stone surfaces reuse the accepted authored texture art with new UV coordinates. Tempest and Tideworn use the accepted weathered limestone texture across retained and new anatomy; subdued slate and shore-stone factors replace the source's high-contrast green/gold swirls. The catalog records this texture donor separately from the source rig. Cinderwake's new anatomy samples the slag tile of the ash atlas. Its fire sits inside the chest, behind the ribs. Every asset retains the source pack, license and attribution plus its exact parent hash, anatomical changes and generator path. No new bitmap texture was required for this derivative pass.

Build and inspect candidates without changing public assets:

```powershell
node tools/regional-bosses/build.mjs
node tools/regional-bosses/audit.mjs --apply
npx vitest run tests/regional-boss-bodies.test.ts --maxWorkers=1
```

The catalog is `test-results/regional-bosses/catalog.json`. The independent audit reloads final GLB bytes, measures full animated geometry and samples weighted sole motion at 180 phases per gait. Its measured walk/run speeds are applied to the staged catalog. `assets/art/regional-bosses/gait-calibration.json` is retained as a production calibration input tied to asset hashes. Browser screenshots and runtime reports remain disposable under `test-results`.

Root schedules these hardware browser loops serially:

```powershell
npx tsx tools/regional-bosses/lab-test.ts --only tempest_roc,tideworn
npx tsx tools/regional-bosses/lab-test.ts --only galeskin,rootheart
npx tsx tools/regional-bosses/lab-test.ts --only mossbound,ordrun
npx tsx tools/regional-bosses/lab-test.ts --only cinderwake
```

The driver installs the staged catalog through the production loader, records complete idle/walk/run/attack/hit cycles at the live playback speed, turns the view with a real right-button orbit, and clicks a production melee action. Hit is checked as the production native masked overlay, including active bones, weight, phase progression and completion. Camera focus remains on the player at ground level, at 8 m zoom within the 6–11 m gameplay limits. Each browser loop is capped at 60 seconds. Root must inspect the images and accept the lab results before promotion and final-world use. Source and CPU audit results alone are not visual acceptance.

The September 10 initial lab batches passed their then-current assertions in 29.525 and 24.083 seconds. Cinderwake's cavity wall initially hid the fire; a repaired core and thinner ribs passed a 13.989-second retake. A 12.904-second side-only loop keeps bodies clear of the workbench panel; Rootheart's highest bough tips extend out of that optional side frame, so its complete frontal views remain the whole-body reference. Initial Hit records contained native masked overlays but the harness did not assert their progression. The revised driver requires that production overlay directly rather than expecting it to replace the base gait clip.

Critic review found a floating Tideworn plate during Attack. CPU projection traced its exact image coordinates to an incompletely removed source jaw. Both stone bosses now replace the entire original head, refit the authored skull pivot, and use an overlapping articulated neck. A regression checks that no original distal-head triangles remain. Tempest completed all full motion cycles and normal orbit after this repair. Tideworn's 23.294-second retake confirmed the attached mouth and coherent limestone across complete gait and Attack cycles, with real melee damage from 104 to 98 HP. Additive Hit over gait exposed a below-floor claw swing. Both stone bosses now brace the heavy torso and claws in front, left and right Hit clips. Focused regressions sample 1,088 base-cycle/additive combinations per reaction, 6,528 combinations across the two bosses.

The final seven-boss Hit loop passed in 20.564 seconds with 81 live samples across nine reactions. Every boss completed its native front Hit overlay, and Tempest and Tideworn also completed HitRight. All seven front screenshots and both right-impact screenshots were inspected. The repaired geometry, materials, bind data and non-Hit animation payloads are byte-identical to the earlier accepted full-cycle views. `node tools/regional-bosses/summarize.mjs` verifies current file hashes, repeats those identity audits and writes `test-results/regional-bosses/lab-acceptance-summary.json` with the exact reports, images and reaction state. Earlier superseded Hit observations are excluded. Root acceptance and final-world promotion remain separate.
