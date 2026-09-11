# Wilderness creature bodies

These actors implement the September 10 Wilderness amendment. Their source lives under `tools/wilderness-creatures/`, and their authored material images live under `assets/art/wilderness-creatures/`. The species module uses the existing production `CreatureSpeciesDef` contract. Root accepted and promoted all eleven final candidates, then registered them in the Wilderness world groups with authored habitats and effects. Final-world browser, navigation and map acceptance remain pending.

The six ordinary creatures have separate body shapes and combat identities.

| Body | Band | Shape and movement |
| --- | --- | --- |
| Cinderback Crag | T50 | Low eight-leg crawler, split basalt mantle and exposed molten tissue between plates. |
| Furnace Grazer | T50 | Headless shoulder dome, broad stone mass and planted crushing forelimbs. |
| Basalt Maw | T50 | Digging predator with a deep open crushing face and braced forebody. |
| Rift Carapace | T70 | Upright separated mantle plates with blue and violet interiors on an eight-leg support cycle. |
| Voidstone Colossus | T70 | Hollow ribbed mass with separated load-bearing stone blocks. |
| Gloam Wraith | T70 | Slit veil and trailing membranes around an empty body, suspended locomotion and a pulling strike. |

The five keepers have newly authored visible anatomy. Ashseal Warden has a broad fused shield limb and seal cavity. Furnace Regent has an open caldera torso and heavy rib mantle. Chainbound Archon has a split floating thorax and pendulous arms. Nightforge Marshal has a hollow gate cuirass and a large asymmetric hammer limb. The Hollow Star uses a radial six-limb body around an empty centre.

The first two keepers use orange molten cavities. The other three use blue and violet fissures. Emission belongs to openings between body structures. The dark exterior surfaces carry mapped stone, iron or shroud detail. Each exported GLB includes its own production materials, skin and eight actions: Idle, Walk, Run, Attack, Hit, HitLeft, HitRight and Death.

`content/wildernessDepth.ts` owns rune assignments and keeper tier multipliers. `content/encounterBalance.ts` computes the actual stat blocks. Keeper combat levels are 150, 200, 210, 280 and 350. The species scale cancels the ordinary tier silhouette multiplier so the authored metre dimensions remain correct at T50 and T70. Final-world miniboss group placement also needs to account for its separate rank multiplier.

Run `node tools/wilderness-creatures/build.mjs` to generate both body sets and merge their staged catalogs. `--merge-only` verifies the existing child exports and combines them without regenerating. The combined catalog is `test-results/wilderness-creatures/catalog.json`. The script checks every asset hash before inclusion. Root alone promotes the accepted catalog using the existing promotion tool.

The focused asset test checks independent identities, computed levels, native scale, complete changing animation tracks, finite geometry, normalized skin weights, mapped body surfaces and emission. It reads promoted production GLBs when present and falls back to staged assets before promotion.

The optional browser driver is `npx tsx tools/wilderness-creatures/lab-test.ts --batch shallow`. Its other logical groups are `deep`, `shallow_keepers` and `deep_keepers`. Use `--ids` to split slow actors into smaller jobs with distinct `--batch` output names. Each job has a 52-second work deadline with a 60-second lifecycle target. Keeper full-cycle jobs use one actor because production stride matching can produce a 17-second walk period. Root runs these jobs serially, inspects the images and performs final acceptance. The driver requires a live rig, observes a complete Walk and Run cycle, waits for actual protected Attack recovery, and checks Hit. It uses normal player focus at ground height, interactive pitch and zoom limits, real animation buttons, and a real right-drag camera orbit. It never detaches or raises the camera target. Generated reports and screenshots are disposable evidence under `test-results/wilderness-creatures/`.

Concurrent ownership is exclusive. The ordinary-body worker owns `tools/wilderness-creatures/ordinary/**` and its matching durable art directory. The keeper-body worker owns `tools/wilderness-creatures/keepers/**` and its matching art directory. Their parent owns the shared staging script, species module, focused test, lab driver and this document. No worker changes shared contracts or the public asset manifest.

All eleven candidates are staged. The two focused tests pass, including the final-byte GLB checks. The ordinary worker also ran an independent Three.js pose audit after recomputing floor contact at 120 Hz, removing unused source vertices and repairing the two crawler leg UV bindings. The keeper worker checked all five weighted exports, UV gutters, eight moving clips and floor contact. Each keeper uses one weighted mesh with at most five material primitives.

The following radii come from the actual exported animation envelopes. The conservative radius uses the union of the horizontal bounds, so it includes the empty corners around a pose. The vertex radius measures the furthest drawn vertex. Ordinary active measurements cover Idle, Walk, Run, Attack and all Hit clips.

| Ordinary body | Active conservative radius | Active vertex radius | Death conservative radius |
| --- | --- | --- | --- |
| Cinderback Crag | 1.719 m | 1.478 m | 2.046 m |
| Furnace Grazer | 2.360 m | 1.990 m | 3.686 m |
| Basalt Maw | 2.749 m | 2.250 m | 2.588 m |
| Rift Carapace | 1.882 m | 1.619 m | 2.284 m |
| Voidstone Colossus | 3.110 m | 2.789 m | 4.332 m |
| Gloam Wraith | 1.324 m | 1.119 m | 1.293 m |

Gloam's downward-folding death keeps its complete envelope inside a 1.35 m court reservation. All five keeper envelopes, including Death, fit a 5 m circle at their intended native final scale. Their idle heights are 4.18 m for Ashseal, 4.64 m for Furnace, 4.59 m for Chainbound, 4.66 m for Nightforge and 4.25 m for Hollow Star.

The Hollow Star belongs to the new `corealm-original-wilderness-keepers` pack. Its pinned source is `tools/wilderness-creatures/keepers/hollow-star.mjs`, under `LicenseRef-Corealm-Original`. The catalog includes its generator hash. The other bodies retain their licensed source rig lineage.

The material revision raises the weathered rock midtones while retaining mapped pores and grain. Core maps carry dark crust among orange or blue heat, with the same map bound to base colour and emission. Natural exteriors explicitly use zero metalness. The keeper revision also reverses incorrect shoulder and wrist cap winding and adds weighted inner knee volumes to the three grounded humanoid bodies.

The first complete-cycle review exposed a live-animation budget issue in Voidstone: 22 separate primitive draws could not enter the ordinary actor's 38-draw pool once shadow cost was included. The generator now joins its identical surfaces by material into four skinned primitives. A 120 Hz comparison across all eight clips found a maximum vertex difference of 0.000000245 m, with identical UVs and envelopes. The focused asset test now rejects ordinary bodies exceeding 19 mesh primitives. The fresh Voidstone browser proof passed with a live rig and four colour plus four shadow draws.

Visual review led to recessed rear walls in Basalt's and Grazer's cavities so their existing molten cores could be seen. Grazer also received a connected broken opening about 0.5 by 0.45 m, preserving its external dimensions and complete animated envelope. Both repaired bodies passed fresh complete-cycle browser checks. Gloam's previously unmapped inner hood wall now has UVs and a narrow irregular blue-violet emission mask. Its centre stays black, and its positions, normals, indices, weighted anatomy, hierarchy and clips remain unchanged. A fresh material retake passed alongside its earlier full-cycle geometry evidence.

Keeper joint interiors now use mapped charcoal, and the revised heat atlas retains visible saturated channels among dark crust. The repair audit proves unchanged positions, normals, indices, skin, hierarchy and animation bytes; only previously unmapped joint UVs were added. The four keepers whose geometry did not change passed new material key views alongside their previous complete-cycle geometry evidence. Use `--key-poses` for a complete material batch, or `--key-pose-ids` to mix material retakes with a full-cycle actor in one bounded job.

Chainbound's separate geometry repair opens its forearm rails and bows its structural ribs to expose the recessed blue-violet interior. CPU rays from the actual prior normal front and orbit camera positions find 53 to 89% and 49 to 76% visible chest core area across sampled Idle, Walk, Run and Attack poses. Its full 60/120 Hz audit has a 4.127 m maximum vertex radius and a 4.526 m conservative union radius, below the 4.7 m reservation. Native channels, skin, hierarchy and materials are unchanged; geometry, UVs and derived floor correction changed. Its earlier material-only equivalence is historical evidence. The rebuilt body's fresh complete-cycle browser job passed in 50.006 seconds. The other four keeper files remain unchanged.

Root added an explicit reaction mask for Hollow's original six-limb topology. `npx tsx tools/wilderness-creatures/hollow-hit-preflight.ts` checks the actual exported model with production Hit, HitLeft and HitRight overlays over Idle, Walk and Run at 120 Hz. All nine combinations preserve the root, thorax and lower-arm transforms exactly, retain at least 0.207 m ground clearance and produce visible upper-limb deformation. Its fresh browser retake also passed: the actual native masked Hit affects only arm chains zero through three and clears after recovery.

All eleven candidates have completed actor evidence and fresh read-only visual PASS recommendations for their final bytes. The last four browser jobs took 50.006, 37.749, 38.119 and 39.979 seconds, with no page or console errors. The focused asset suite passed two tests after the final exports. Root inspected the remaining bodies, accepted all eleven and promoted their final bytes. Root also reports 19 passing world-content tests after integration; these do not replace the pending final-world browser gate.

Run `node tools/wilderness-creatures/evidence-index.mjs` to regenerate `test-results/wilderness-creatures/acceptance-index.json`. It lists exact hashes, current report and screenshot paths, material-equivalence audits and retained full-cycle geometry evidence. It explicitly records Rift's completed actor evidence before a different actor failed, and Hollow's old Hit failure superseded by its current successful retake. The index does not promote assets. Gallery evidence covers stationary production motion, normal camera controls, mapped material draws and bounded particles following or culling with actors; moving foot planting, combat timing and final-world placement belong to root's world gate.
