# Corealm rebuild acceptance receipt

September 4, under the [approved scope](./PRD.md). The latest correction removes the blocky foliage distance replacements. This receipt records tested changes and remaining work; the complete game has not passed production release acceptance.

Checkpoint update, 2026-09-05: this is historical evidence, not current release acceptance. Read [PARALLEL-HANDOFF.md](./PARALLEL-HANDOFF.md) and [CHECKPOINT-VALIDATION.md](./CHECKPOINT-VALIDATION.md) for the stopped round. The user has since rejected the current ore and quadruped art. New candidate files and lab-only integrations remain unfinished.

## Detailed foliage at every visible distance

All ten simplified far models and their generator/catalogue were removed. The runtime uses the native oak, pine, fern and shrub geometry at every visible distance, with the same material and wind path. Ordinary instancing and spatial culling remain. Nearby harvestable trees preserve their scatter placement, species, scale, materials and stable saved identity.

The 17 native foliage/deadwood/stump files use packed normal, colour and blade UV attributes. Their total size fell from 54,597,192 to 35,653,488 bytes without changing positions or topology. Bark retains its physical UV coordinates. Production Three.js loader readback was checked. Geology now has 19 original assets, including matching active/spent ore, layered outcrops, cliffs and scree. Nine shared albedo, normal and roughness maps cover bark, leaf and stone surfaces. These delivered counts do not establish catalogue-wide art acceptance.

The distance gate exercises `environment.showFoliage()` through near, far and return poses for all ten living foliage assets. It compares actual colour submissions against the served native triangle counts, checks bounds and instance populations, waits for matching panel metadata, and rejects alternate far requests. The final rerun passed in 10.938 s after static render partitioning and the panel-mode guard. Root inspected representative near/far screenshots. A separate 1,024-shrub turn-away/return check preserved every shard and restored the same submitted colour geometry; root inspected all three views. Fresh read-only review found no callback, native-geometry, wind or shadow-bounds regression.

## Rendering measurements

The 96 m world generation grid, seeded candidates and saved tree IDs remain unchanged. The accepted dense lab change partitions existing native placements into 24 m tree groups and 12 m fern/shrub groups. The world then uses the same grouping helper. Smaller groups let the camera reject off-screen geometry while retaining every instance and its detailed source.

At the same 1,024-shrub fixture and camera, total submitted triangles fell from 37,843,150 to 13,067,182. Draw calls increased from 62 to 104. Root inspected both screenshots and found the same visible plants. The short FPS sample did not improve, so this establishes reduced submissions, not a frame-rate claim.

The authored-world samples used Chromium hardware D3D11 at 1440 by 900, production graphics, settled asset loading and two seconds of frame samples per fixed pose. They are diagnostics, not a release benchmark.

| View | Submitted triangles, before / after | Draw calls, before / after | Median frame ms, before / after |
| --- | --- | --- | --- |
| Coldbrace forest | 270.094 M / 156.790 M | 375 / 1080 | 48.3 / 33.4 |
| Bracken workings | 314.170 M / 137.075 M | 381 / 1160 | 45.5 / 27.8 |
| Lower quarry bench | 484.791 M / 215.601 M | 517 / 1564 | 77.9 / 38.4 |
| Upper seam shelf | 120.863 M / 43.223 M | 311 / 445 | 34.1 / 15.8 |
| Clinker cut | 239.082 M / 106.961 M | 403 / 1043 | 56.7 / 17.8 |

The Hollowcut capture was camera-occluded and is excluded from normal-view performance evidence. Heavy forest and quarry views remain too expensive. An offline study found little removable interior tessellation within a 0.5 mm geometry-error bound while retaining every leaf and branch. No candidates were published. Do not restore blocky distance substitutes to meet a budget.

## Gameplay and build evidence

| Check | Latest recorded result | Scope |
| --- | --- | --- |
| TypeScript and unit suite | PASS, 718 tests in 101 files | Integrated source after native render partitioning. |
| Production build | PASS, 1.498 MB critical JS/WASM against 1.500 MB; 0.345 MB initial app against 1.000 MB | Original payload ceilings retained. |
| Combined building/combat lab | PASS, 41.557 s | Production structure controls, camera and walking, bank transfers, equipment, actual target selection, melee and spell damage. Four inspected reduced-graphics screenshots establish layout and interaction evidence, not production art quality. |
| Forest lab | PASS, 26.183 s | Real click, navigation, natural harvest/depletion, saved stump, distant return and regrowth. Root inspected all three screenshots. |
| Full-world resources | PASS, 44.926 s, after render partitioning | Natural ordinary-tree harvest, saved stump after distant return, and actual Cairn dry-bank approach with a natural Cragfin receipt. Root inspected all three screenshots. |
| Fishing lab | PASS, 10.041 s | Real click, dry approach and natural fish receipt in the compact production pond. |
| Creature lifecycle | PASS, 91.677 s, before the four latest hit-clip revisions | Aggression, damage, attack, flee/leash/return, corpse, XP, respawn and boss spawning. |
| Latest bear/cattle/aurochs/boar hit clips | Root inspected production gallery motion samples | Articulated head/shoulder/pelvis response with planted feet. Non-hit clips and geometry remain unchanged. Boar retains up to 5.08 mm sole shear from inherited skin weights. |
| Deferred production panel | PASS, 7.119 s | Actual altar context interaction, delayed import cancellation, natural Air Wand craft, one input/output and exactly 24 XP. |
| Deferred overlays and companion panel | PASS, 13.828 s | Delayed import cancellation, offline panel expansion/collapse, live tooltip quantity refresh, real lethal attacks/death UI, recovery-cache opening and exact five-item receipt. Root inspected all four screenshots. |
| Reusable cut-face lab | Root accepted local mining and extraction view | Eight natural mining receipts at normal clock rate, then depletion and visible extraction scar. API-started interaction does not establish pointer acceptance. |
| Navigation artifact | Rebuilt, 1,265,705 bytes, 6,343 polygons | Current fingerprint `0500adf49d480be836f1124b47cedac496a744ac8af0fd30e70256660ec36118`. |
| World map | Regenerated from all 576 actual-scene tiles | 4800 px detail is 1,271,882 bytes against 1,275,000; minimap is 118,314 against 150,000. Native-resolution crops accepted with quality 60 retained using the photo encoder and standard chroma sampling. |
| Documentation build | PASS, 59 pages | Original-model provenance verifies checked-in generator paths and hashes; existing third-party URL, license and archive-hash checks remain. |

Browser reports and screenshots live under ignored `test-results/foliage-distance-lab`, `world-resources`, `forest-lab`, `fishing-lab`, `creature-lab`, `production-panel-lab`, `deferred-overlays-lab`, `foliage-density-before`, `foliage-density-after` and `world-art-current`. The persistent inspection journal is `test-results/rebuild-acceptance/session.jsonl`. Generated evidence is disposable and may be overwritten; this receipt preserves its scope and accepted results.

Debug grants, fixture setup, teleports, save import and clip selection are diagnostics. Natural interactions and real pointer actions are identified separately in the reports. A passing command, animation timestamp or source audit does not grade visual quality.

## Developer loop

The [baseline model audit](./model-audit.md) parsed all 273 original GLBs and recorded family dispositions. It remains a technical census of that revision. The current served manifest contains 309 models. Twenty-five creature files have motion rebuilds, with the latest four planted hit reactions reviewed separately.

The environment panel exposes actual model/site assets, native foliage grid/lane controls and the sloped two-seam cut face. Forest and fishing fixtures exercise production gathering and persistence. `lab-session --compact` retains full command/results in JSONL, rejects unavailable scenes and empty actors, and supports bounded semantic entity waits. Source-string and obsolete far-geometry tests were removed while state, deterministic placement, persistence, collision and real-asset compatibility coverage remain.

Exact workflow and commands are in [feature-lab.md](../../docs/feature-lab.md) and [world-authoring.md](../../docs/world-authoring.md). World placement uses the narrow spatial-integration exception recorded in the PRD; isolated reusable assets still require lab proof.

## Remaining acceptance work

- Improve mine and dungeon composition. World screenshots expose overly regular cut-face ribbons, angular terminal wedges and weak portal integration. Local mining correctness does not accept these full-world forms.
- Complete catalogue-wide visual review, including items, settlement dressing and remaining creature contact/recovery. The rhinoceros frontal reaction still has foot sliding and its directional clips need a separate correction.
- Reduce heavy-world frame cost without changing visible model detail. Current measurements do not establish stable 60 FPS or a production hardware range.
- Review the authored fishery landforms themselves. Cairn's dry approach now works, but that does not approve its steep basin/berm shape as final art.
- Review the ocean/coast presentation. The regenerated actual-scene map exposes a straight-edged tonal patch outside the southwestern coast; encoding does not fix that source-scene defect.
