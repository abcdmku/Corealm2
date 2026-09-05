# Creature model production

All 24 species are staged with eight clips each, manifest-shaped metadata and passing compiler geometry/skin audits. The staged GLBs total 80,092,132 bytes and 708,992 triangles. Root owns production promotion, the persistent feature lab, gameplay checks, screenshots, and later world placement. The initial turkey and beetle failed root's production closeups; revised representatives and the remaining revised families are ready for that review. No count in this document claims final visual acceptance.

## Ownership and sources

The staging compiler is `tools/build-creature-expansion.ts`; its browser entry is `tools/creature-expansion/convert.html`. Model modules export a Three.js object, the eight required animation clips, and source, gait, and attack metadata. They do not write live GLBs, the production manifest, game code, or shared contracts.

| Module | Species | Geometry source |
| --- | --- | --- |
| `mammals.mjs` | Redbrush fox, Duskoak lynx, Rootdelve badger, Quillback porcupine | Original anatomy, skins, fur treatment and articulated animation |
| `hoofed.mjs` | Marchwild horse, Cairn bighorn, Marsh moose, Bracken tapir | Original anatomy, skins, material treatment and planted-hoof animation |
| `reptiles.mjs` | Slateback tortoise, Ashscale monitor | Original anatomy, scutes/scales, skins and articulated animation |
| `birds.mjs` | Blackwater heron, Scree bustard, Marchfield turkey | Original anatomy, fitted feather geometry, skins and ground-bird animation |
| `crawlers.mjs` | Antler beetle, Slag centipede, Hollowroot spider | Original chitin anatomy, textures, articulated appendages and contact gaits |
| `imported-animals.mjs` | Reedjaw crocodile, Kiln salamander, Reedbank goose, Quarry snail | Four distinct unused Animal pack deluxe bodies, exact source clip windows, new missing articulation and motion |
| `monsters.mjs` | Cinder ravager, Basalt drake, Gorge mantis, Quarry nightmare | Distinct unused Monster04, DragonBoar, Monster09 and DragonTheNightmare source bodies |

Licensed imports retain their source attribution. Source staging manifests record file hashes. Original geometry is not described as a licensed source modification; imported meshes are not described as wholly original. The raw library locations and clip windows are recorded in `creature-expansion-design.md` and the import-module README files.

`tools/creature-expansion/packs.ts` separates the original project pack from five licensed source packs. The Unity archives' embedded Asset Store metadata supplied the exact product IDs. Those IDs were checked against the official product pages, and the actual five local archives were hashed. `packs.json` and `manifest.json.packs` carry these records; the original pack instead records the current compiler's SHA-256. `--refresh-metadata` refreshes pack mappings and the generator hash without rebuilding GLBs. Root must register `tools/build-creature-expansion.ts` in the existing original-generator allowlist before the documentation gate accepts that pack.

## Reproduction and staging

Run a narrow build while an authoring round is active:

```powershell
npx tsx tools/build-creature-expansion.ts --only antler_beetle
```

The full command with no `--only` selects the frozen 24 IDs. Use it only after the model owners finish their revisions. All output stays under ignored `test-results/creature-expansion/`:

- `models/creature_<species>.glb` contains the staged asset.
- `<species>.json` records manifest-shaped identity, file, bounds, base, ground minimum, triangles, bytes, SHA-256, clips, materials, provenance, gait and contact timing.
- `<species>.audit.json` contains geometry, skin, animated-bound, cycle-endpoint and sampled-foot diagnostics.
- `manifest.json` collects successful staged rows. A failed selected rebuild removes the stale row and writes `buildFailed: true` in its per-species metadata.

`--serve` starts a loopback static server for the asset compiler and source inspection. It does not boot the game. The import module staging scripts reconstruct the approved raw source copies from the owner's existing local library.

## Asset checks and their limits

The compiler rejects missing or empty required clips, unresolved or ambiguous animation targets, unsupported glTF animation properties, missing UVs or normals, nonfinite accessors, inconsistent attribute counts, non-triangle draw modes, invalid triangle indices, invalid skin indices and weight sums, and nonfinite deformed vertices. It samples deformed bounds at five points in all eight clips. Required names are `Idle`, `Walk`, `Run`, `Attack`, `Hit`, `HitLeft`, `HitRight` and `Death`.

The motion report separately samples 96 points in each exported walk and run. Explicit author-supplied sole joints take precedence over generic distal-foot detection. It reports stance speeds, foot vertical and longitudinal travel, skeleton-root horizontal travel and loop endpoint gaps. These measurements are diagnostics, not a substitute for moving a production actor and inspecting planted contact.

The monster source audit caught a wrong speed calculation that divided stride by the whole cycle, ignoring stance duration. Import metadata uses named contact joints and the backward stance interval. The original ravager archive run was fast: its raw root travel independently measured roughly 12 metres per second before root travel was removed. That source motion required the Cinder-specific gait repair recorded below to fit root's gameplay target.

Source inspection also found Monster09's named walk/run clips hover. The mantis therefore uses an authored grounded leg cycle and folded wings while retaining the source body's upper articulation. Missing goose wings, salamander jaw and snail eye-stalk articulation were authored explicitly. The snail's continuous sole requires a different contact interpretation from a legged animal.

## Visual review rule

Triangle totals do not certify detail. The first original drafts exposed smooth blank body masses, visible limb/neck cap seams, raised shell halves, button-like eyes and thick repeated feathers. Those defects were rejected. Revisions must remove the faulty anatomy or material treatment, then return one representative to root's actual lab for review before a broader export or world population integration.

Disposable source previews help reject obvious model defects before that step. They are not production-lighting or gameplay evidence. Root's real lab screenshots and semantic motion/combat checks remain the acceptance gate. This report intentionally records the authoring process and limits; it does not promote diagnostic screenshots as durable acceptance evidence.

## Current staged handoff

`test-results/creature-expansion/manifest.json` contains exactly the frozen 24 asset IDs and six pack records. `packs.json` supplies the same records separately for root's manifest merge. Each asset JSON includes its source provenance, geometry bounds, ground minimum, file hash, materials, eight clip names, clip durations, measured gait diagnostics and attack contact timing. All acceptance records deliberately retain `labAccepted: false` and `worldIntegrated: false`.

The final independent read-only staging review passed: 24 expected assets, 192 valid exported clips, matching GLB hashes and byte counts, consistent per-asset/catalog metadata, six resolved pack references, the current generator hash and passing per-asset audits. The compiler and pack registry also passed focused strict TypeScript checking. Root's combined game/lab checks were not run by this worker.

| Species | Triangles | GLB bytes |
| --- | ---: | ---: |
| Redbrush fox | 34,500 | 1,703,828 |
| Duskoak lynx | 34,540 | 1,692,504 |
| Rootdelve badger | 31,088 | 1,544,448 |
| Quillback porcupine | 33,960 | 1,799,040 |
| Marchwild horse | 55,852 | 2,614,564 |
| Cairn bighorn | 49,032 | 2,360,220 |
| Marsh moose | 56,432 | 2,641,056 |
| Bracken tapir | 65,094 | 3,092,188 |
| Reedjaw crocodile | 6,390 | 5,820,000 |
| Kiln salamander | 2,160 | 3,569,736 |
| Slateback tortoise | 34,916 | 2,588,512 |
| Ashscale monitor | 34,374 | 3,137,032 |
| Reedbank goose | 12,762 | 4,495,884 |
| Blackwater heron | 34,840 | 2,835,276 |
| Scree bustard | 39,936 | 3,219,696 |
| Marchfield turkey | 45,480 | 3,476,276 |
| Quarry snail | 17,888 | 6,528,544 |
| Antler beetle | 33,250 | 1,906,672 |
| Slag centipede | 31,442 | 2,428,920 |
| Hollowroot spider | 33,950 | 1,998,484 |
| Cinder ravager | 6,094 | 3,502,024 |
| Basalt drake | 3,230 | 6,511,488 |
| Gorge mantis | 7,400 | 3,559,432 |
| Quarry nightmare | 4,382 | 7,066,308 |

The final narrow refresh includes the heron and bustard's downward breast plumage, the tapir's settled Death nose, and the crocodile bite contact at `11 / 24` of its 0.833333-second attack. Turkey retains the geometry currently sent to root for review. Beetle's former blue ventral band is replaced by mapped dark chitin with shallow sternite divisions. Mammals and hoofed animals use joined weighted anatomy; the imported snail has a rebuilt smooth shell and spiral gutters; the goose's added folded vanes follow its source flank.

Root authorized and the bird owner completed the feather sampling reduction: eight cross-section samples became four while every longitudinal ring and silhouette edge remained; collapsed root/tip triangles were omitted. The staged models are now 34,840 / 39,936 / 45,480 triangles for heron / bustard / turkey. Before/after checks preserve every retained vertex, all eight clip/skeleton/material/metadata hashes and sampled outline extrema within `1.42e-13` metres. Separate edge-normal seams prevent the coarse cross-section from darkening the feather fields. Source images show slightly stronger fine vane contrast, with no material or silhouette replacement. The geometry audit still records other existing degenerate seam/cap triangles as notes rather than claiming every triangle contributes detail.

Production review still needs to establish the close-view anatomy and material response, moving contact at the tuned scale and cadence, attack contact timing, directional hit readability, blend transitions and settled death poses. Source dimensions and `groundY` are measured metadata; root must apply the production transform consistently. No live assets, live manifest entries, game code, shared contracts or world placements were changed by this production worker.

## Gait reconciliation and production probe correction

The follow-up change in `tools/creature-walk-probe.ts` consumes the renderer's `drawnStrideScale`, supplied by root as `abs(record.scale * record.build[2] * record.scaleAxes[2])`. `record.scale` already includes the placement and tier multiplier. Reported foot speed is now `impliedGaitMps * drawnStrideScale * timeScale`, with the actual scale printed as `scaleZ`. Missing scale telemetry leaves foot speed and slide unavailable instead of silently assuming native scale. The lookup also resolves the lab's `species:<id>` presets through `CREATURE_SPECIES`; previously only region and dungeon groups resolved.

Focused strict TypeScript checking passed. Browser-free checks of the actual source functions cover a twice-size walk, a compound placement/build/axis scale, the ravager Run reference, unavailable scale telemetry, and region/dungeon/species asset resolution. No gameplay speeds, live models or live manifest fields changed. Production browser execution remains root's gate.

All 24 staged gait and attack records agree with their per-asset metadata and exported clip durations. The largest author-versus-export duration difference is `9.54e-8` seconds. Retain the following native-model references; these are inputs for production scale and playback matching, not recommendations to set every creature's simulation speed to the native value.

| Species ID | Walk / Run m/s | Walk / Run seconds | Attack seconds | Contact fraction | Exported stance Walk / Run m/s |
| --- | ---: | ---: | ---: | ---: | ---: |
| antler_beetle | 0.446429 / 1.403509 | 1.260000 / 0.700000 | 1.100000 | 0.500000 | 0.446374 / 1.402527 |
| ashscale_monitor | 0.476948 / 1.686508 | 1.360000 / 0.720000 | 1.100000 | 0.480000 | 0.476992 / 1.686257 |
| basalt_drake | 1.028166 / 3.674626 | 1.000000 / 0.800000 | 1.600000 | 0.650000 | 1.076956 / 3.681571 |
| blackwater_heron | 0.480000 / 1.300000 | 1.280000 / 0.580000 | 1.050000 | 0.455000 | 0.479980 / 1.299933 |
| bracken_tapir | 0.739247 / 2.393617 | 0.930000 / 0.640000 | 0.900000 | 0.480000 | 0.739148 / 2.393206 |
| cairn_bighorn | 0.921053 / 2.593085 | 0.950000 / 0.640000 | 1.050000 | 0.460000 | 0.920930 / 2.592728 |
| cinder_ravager | 0.899996 / 3.000005 | 1.333333 / 0.666667 | 2.333333 | 0.235000 | 0.899999 / 2.999998 |
| duskoak_lynx | 0.561651 / 2.510176 | 1.160000 / 0.670000 | 1.020000 | 0.430000 | 0.561650 / 2.506894 |
| gorge_mantis | 1.147541 / 2.833333 | 1.000000 / 0.666667 | 1.000000 | 0.316667 | 1.147516 / 2.833505 |
| hollowroot_spider | 0.554296 / 1.683673 | 1.260000 / 0.700000 | 1.040000 | 0.500000 | 0.553988 / 1.683019 |
| kiln_salamander | 0.235562 / 0.372631 | 1.300000 / 0.833333 | 1.080000 | 0.430000 | 0.234376 / 0.370968 |
| marchfield_turkey | 0.600000 / 1.150000 | 1.030000 / 0.530000 | 0.780000 | 0.455000 | 0.600118 / 1.149857 |
| marchwild_horse | 1.107955 / 3.343465 | 1.100000 / 0.700000 | 1.180000 | 0.460000 | 1.107830 / 3.342987 |
| marsh_moose | 1.229508 / 3.409711 | 1.220000 / 0.780000 | 1.230000 | 0.470000 | 1.229489 / 3.409473 |
| quarry_nightmare | 0.741300 / 2.544100 | 1.333333 / 1.000000 | 1.200000 | 0.720000 | 0.725170 / 2.427072 |
| quarry_snail | 0.013362 / 0.053674 | 4.400000 / 2.600000 | 1.500000 | 0.480000 | 0.028842 / 0.075221 |
| quillback_porcupine | 0.290909 / 1.166268 | 1.250000 / 0.760000 | 1.160000 | 0.540000 | 0.290913 / 1.166392 |
| redbrush_fox | 0.534759 / 2.066116 | 1.020000 / 0.660000 | 0.880000 | 0.490000 | 0.534782 / 2.063578 |
| reedbank_goose | 0.227095 / 0.433296 | 0.966667 / 0.533333 | 1.140000 | 0.460000 | 0.228448 / 0.438638 |
| reedjaw_crocodile | 0.418908 / 1.754904 | 1.433333 / 0.566667 | 0.833333 | 0.458333 | 0.423786 / 1.684424 |
| rootdelve_badger | 0.355731 / 1.307597 | 1.150000 / 0.730000 | 1.100000 | 0.460000 | 0.355702 / 1.308490 |
| scree_bustard | 0.640000 / 1.300000 | 1.080000 / 0.560000 | 0.800000 | 0.455000 | 0.640043 / 1.299660 |
| slag_centipede | 0.312925 / 0.936524 | 1.050000 / 0.620000 | 0.940000 | 0.500000 | 0.312454 / 0.935134 |
| slateback_tortoise | 0.065789 / 0.168350 | 2.800000 / 1.800000 | 1.450000 | 0.490000 | 0.064890 / 0.167595 |

Cinder's original Run discrepancy was a measurement-method error: `1.869346593 m` maximum foot excursion divided by the entire `0.666666687 s` cycle gave `2.804019805 m/s`, while measuring backward foot velocity during contact gave `10.206861931 m/s`. Independent exported sampling of that original clip gave `10.100632295 m/s`, 1.041% lower. Raw source root travel was approximately `11.990458 m/s` Run and `2.029632 m/s` Walk after final size normalization. Those measurements explain the earlier disagreement; they are superseded by the physically revised gait below. Basalt's unchanged full-cycle equivalents similarly understate its references: `0.600896 / 1.689128 m/s` versus stance references `1.028166 / 3.674626 m/s`.

Across the 18 creatures with authored IK locomotion, including Mantis and the revised Cinder, exported stance differs from the authored reference by at most 1.37%. The five remaining sampled legged imports differ by at most 4.75%. Their contact-window definitions differ: the compiler uses 96 samples and the lowest 12% of vertical travel; imported animal authoring uses 120 samples and 20%; Basalt uses 240 samples with a bounded 12% window; Nightmare uses 120 samples and 35%. Agreement validates a useful reference speed, not every individual foot. Basalt's Run sole medians span approximately 2.12–4.45 m/s even while the pooled reference is 3.675. Moving production inspection must decide whether that residual source motion reads acceptably.

Snail needs separate continuous-sole interpretation. Its Walk reference `0.013362 m/s` is below the generic exported probe's `0.02 m/s` rejection threshold. The resulting +115.85% Walk and +40.14% Run diagnostic differences must not replace its authoring references or be treated as ordinary leg-contact failures. Keep its current crawl references provisional until production travel is inspected.

The production walk probe also retains its existing `0.2 m/s` moving-sample threshold. Its aggregate slide result therefore does not assess very slow snail or tortoise travel. Direct displacement and crawl/contact review are needed for those cases. This limit was reported to root and left outside the bounded scale correction.

After the third production close-view review, root cleared turkey and horse form for motion acceptance and held beetle and fox for specific visible defects. The completed repairs add articulated chitin overlap and a restrained rear-shell division to beetle, and broader shorter ears, volumetric paws and toes, an integrated lower muzzle, and a longer white distal brush to fox. The approved bird sampling reduction is also staged. The inventory above describes these latest exports.

The next full-catalog production review extended the paw/ankle hold to all four mammals and added spider abdomen/mouthpalp continuity, tapir toe/ankle form and bighorn horn-ring refinement. Those source repairs are complete and staged. Root also requested and received a Cinder-only gait repair: actual stance near 0.9 m/s Walk and 3 m/s Run at native cadence, preserving the model scale and source one-shots. Its previous 10.207 m/s Run was unsuitable for that gameplay target. The reference table now uses the revised motion's measured values. Root owns the accompanying content-speed integration.

The revised mammals have raised palms/instep geometry joined to their ankles, with species-specific toes and claws; their eight-clip checks limit the worst sampled mesh penetration to 3.32 mm. Beetle's continuous femur surfaces enclose each articulated lower segment, with at least 10.94 mm audited reserve across joint rotations. Spider's abdomen now has smooth native topology and matched seam normals; its mouthparts taper into the head and the cuticle has restrained highlights. Tapir's continuous ankle-to-digit surface replaces separate tall toe blocks, and an additional local curvature/normal pass removes visible triangular planes without erasing the clefts. Its 4,549 sampled sole vertices stay above ground with at most 0.328 mm stance drift. Bighorn retains its curled horns with shallow growth cuts. All these exports pass compiler geometry and skin checks and await root's production re-review.

## Final Cinder motion repair

The revised Walk and Run solve each source leg chain against shorter planted paths: 0.72 m Walk and 0.68 m Run contact spans at unchanged 1.333333 / 0.666667-second durations. Knees remain bent and reachable. Source upper-body motion remains; Run ankle roll is reduced to 40% and knee-plane variation to 50% around the source plant. The compact gait also reduces root bounce. Direct source-track interpolation restores every IK-written bone before each sample, avoiding AnimationMixer caching of the previous solved pose. Scale remains 0.012, and geometry is unchanged.

The actual staged GLB passed a 1,920-phase audit after reload through GLTFLoader. Walk toe medians are 0.89999989 / 0.89999258 m/s; Run medians are 2.99991723 / 3.00005414 m/s. Worst Run P95 speed error is 0.004298 m/s. Trimmed-stance mesh-sole clearance stays 1.891–3.385 mm, maximum lateral displacement is 0.7961 mm, and horizontal root drift is `5.56e-8` m. Loop track endpoints are exact and toe endpoint error is below `9e-8` m. All six other source clip hashes remain unchanged before export; after export their durations match exactly and sampled world-bone positions differ by at most `6.75e-7` m. Exported key arrays need not have identical hashes after resampling, so the roundtrip checks motion semantics explicitly.

The default export resampling tolerance of `1e-4` initially degraded this repaired contact: actual GLB Run-left P95 error was 0.158884 m/s against the 0.15 gate, although source motion passed. The compiler now accepts a validated per-asset `animationResampleTolerance` in `(0, 1e-4]`; Cinder sets `1e-6`, while all other assets retain the previous default. The tighter export passes the same dense contact audit. Walk retains 240 Hz authored keys and Run 960 Hz because lower source key density failed its interpolation check; these are offline animation samples, not a runtime render-rate requirement.

Final evidence is `test-results/creature-expansion/sources/monsters/cinder/gait-roundtrip-audit-1920.json`, reproduced by `node tools/creature-expansion/monsters/cinder/audit.mjs --glb=test-results/creature-expansion/models/creature_cinder_ravager.glb --phases=1920`. The compiler audit records the applied tolerance. This compiler change updates the original pack's generator SHA-256 to `9a42f48ae7c563a5c3331dcd6f610d510db3609544b474b9f62fa25d42acd4e1`; staged `packs.json` and `manifest.json.packs` contain that record for root's merge.

## Player jog correction supplied for root integration

Root separately authorized `game/src/render/playerLocomotion.ts`, focused tests and source diagnostic tooling. `bakePlayerJog(sourceClip, restBody, targetNativeMps = 3.5)` returns `{ clip, diagnostics }`. At the existing 1.2 playback rate its shorter native stride matches 4.2 m/s travel. Call during character construction with the rest body, keep the returned clip as a private action override, and leave the shared asset registry untouched. The module caches by source clip identity, target speed and relevant rig transforms. The final cold bake measured 12.89 ms for the male body and 6.14 ms for the female body; an independent earlier cache measurement was 0.315 ms.

Only six thigh/calf/foot quaternion tracks change; the other 189 tracks, including pelvis translation and rotation, remain byte-equivalent and independently cloned. Clip name, duration and blend mode remain unchanged, with a private UUID. The solver works in the fixed metre/Y-up body frame because the imported root rotates local axes by -90 degrees around X. It projects the original knee bend plane before solving the shorter chain, preserves original foot world orientation and toe articulation, includes every source interpolation knot, and closes the six new tracks. The final clip has 225 samples per rewritten track. Source library and supplied rest body remain unchanged.

The browser-free audit loads actual shipped animation/body/boots GLBs, retains original BIN geometry and skin matrices, and attaches boots through production rebind code. At 1,920 intervals per cycle, native ball medians are 3.49881 / 3.50346 m/s. Real boot sole vertices within 5 mm of their original cycle minimum have world slip median/P95 of 0.05466/0.10151 and 0.05492/0.10369 m/s for male left/right, and 0.05942/0.08158 and 0.05929/0.08373 for female left/right. The same source vertices previously slid around 3 m/s. The broader 15 mm window retains heel/toe roll and reports median 0.1096–0.1405 m/s, P95 0.3446–0.5967 m/s; those values are not hidden by the tighter contact diagnostic.

Maximum foot orientation difference is 0.0001518 rad. Contact sole X/Y movement relative to the original clip remains below 0.0051/0.1489 mm. Maximum IK error is `1.86e-7` m with 0.1134 m reach reserve. Existing shoe cycle minima, about -20.17 mm male and -18.38 mm female in the source frame, are preserved within 0.026 mm. Calf-weighted heels change slightly during the airborne portion, up to 5.76 mm male / 20.26 mm female; no source skin weights or mesh geometry are rewritten.

Four shipped-asset tests and scoped strict TypeScript checks pass. Reproduce the independent dense proof with `npx tsx tools/player-locomotion-audit.ts`; output is `test-results/player-locomotion/audit.json`. Root still owns runtime wiring, movement rate policy and production lab acceptance. A fixed baked loop corrects steady forward travel; acceleration below the existing 0.9 playback floor, turning and crossfades still have residual contact motion. No gameplay speed, shared GLB, registry, CharacterRig or boot code was edited by this worker.
