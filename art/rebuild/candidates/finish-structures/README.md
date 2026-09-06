# Structure finishing candidate

Status: staged, not visually accepted or promoted.

The two GLBs are deterministic rebuilds of the existing connected Sunder Ledge and Scree Slide source. This round changes no geology shape. The staging CLI now permits candidate output beneath `art/rebuild/candidates`, while rejecting paths that escape either allowed staging root. Public models and the manifest were not changed.

Rebuild with Node 24:

```powershell
npx tsx tools/build-corealm-geology.ts --only corealm_sunder_ledge,corealm_scree_slide --out art/rebuild/candidates/finish-structures
```

The accompanying catalogue records source hash, GLB hashes, dimensions, legacy placement offsets and triangle counts. Sunder has 36,009 triangles; Scree has 19,704.

The source dungeon pass preserves the walkable floor buffers and closed shell. Wall UVs now share absolute vertical phase and continuous perimeter distance at adjacent panels and courses, with one unavoidable closed-perimeter wrap seam. Shelf relief tapers fully away in patches instead of leaving a continuous lip. Creased normals retain sharp fractures while smoothing shallow plane transitions. Restrained spatial tint replaces identical colours around each ring.

CPU verification passed 82 dungeon tests and 31 structure/geology tests before the final staging-path assertion was added. The root must run the final combined gate. Structure lint scanned 731 cases; its 72 floating warnings all concern vault-door torches and banners tested without their supporting tower wall. Do not treat those as verified world defects or suppress them without host-context proof.

## Acceptance still required

- Run the preserved `runs/corealm-rebuild/checks/cave-material-review.ts` against the scheduled production Vite server. Inspect chamber, wall, floor and upward roof captures. Check headroom and shell rays before accepting the art. Flat roof/cylindrical overall silhouette and uniform torch lighting remain broader art-review questions.
- Use the production building lab to compare stall footprints 3 x 2 and 16 x 3. The market-stall hero retains native geometry in both; collision now matches its measured 1.845 x 0.932 m bounds. Walk past both edges. Loose goods are dressing outside the structural counter collider.
- Preview staged Sunder and Scree through the production environment gallery using candidate interception. Inspect both sides and approach height before root promotion.
- After promotion, prove actual full-world shortcut entry, collision and landing paths. This uses the world-authoring exception because terrain embedding and distant landing cannot be proved in the isolated gallery.
- Traverse every town door from oblique approaches and orbit the camera. Check standalone wall runs beyond settlement pads; world wall runs currently use their first endpoint as their grounding datum, while settlement pad computation omits standalone wall runs and props.
## Hardware review, 2026-09-05

The root scheduled an exclusive hardware slot. All four serial helpers passed and closed their browsers:

- Cave material review: `test-results/cave-material-review/report.json`, four captures inspected. Coherent stone phase and opaque shell are visible. Broader cave art is rejected for completion: chamber walls still show horizontal dark shelf bands and cylindrical outlines, the roof remains broad and flat, and lighting is uniformly warm.
- Compact portal transition: `test-results/portal-transition-browser/report.json`. The inside capture shows a real unobstructed dark recess. Entry and return semantic checks passed.
- Staged Sunder/Scree gallery: `test-results/finish-structures-gallery/report.json`, all four captures inspected. Front fractures and descending rubble read clearly. Opposite views have broad flat rear faces and green slivers beneath the fitted negative-Y edge. Final terrain embedding remains required before promotion; these are not approved as freestanding rocks.
- Final-world manual portal: `test-results/finish-portal-world/manual/report.json`. New approach/return views show both sides of the paving and a stone recess floor without grass triangles. Inside view shows the dark rear after moving the exit inward. Those specific placement defects pass this view. Cave art remains unfinished. Mid-height rocks beside the interior arch look unsupported, and the high exterior camera exposes a dark rear silhouette above the front crown.

The GPU slot was explicitly released. No settlement browser checks were run in this slot.

## Current cave and mantle review

The surface mouth now has a closed, grounded rock mantle around the opaque recess. Interior mouths omit it. `game/src/world/portalMantle.ts` supplies the same bounds to rendering and collision. The clean exclusive `finish-portal-mantle.ts` pass captured front, right and rear after real body movement against the production collider. Root accepted the physical mantle and wired its world solid. World bank embedding still needs a current capture.

The unsupported interior cap dressing was removed. Two low Corealm strata outcrops now rest at ground level beside the supporting masonry.

`test-results/finish-cave-relief-v2` replaced the continuous shelf profile with oblique relief, uneven roof fractures and separate cool ambient/warm lamp lighting. Root accepted the improved banding but rejected the remaining cylindrical chamber form. The subsequent CPU pass adds larger oblique buttresses above the 3.4 m walking envelope and blends wall base colour toward the floor. The new upper rock camera volumes do not enter navigation solids. All 43 focused shell, material, portal-fit and mouth tests pass. This latest form is awaiting a scheduled hardware pass through `finish-cave-relief.ts`, which writes `test-results/finish-cave-relief-v3` with current source hashes. Do not reuse v2 as acceptance of these bytes.

The catalogue planner retains 905 parameter cases and 479 exact parts-plus-hero groups. Its 224 representative case keys cover 108 named variants, all 59 authored buildings, 91 composition geometries and nine wall witnesses. `finish-structure-catalogue.ts` captures at most eight representatives in each 60-second hardware shard and checks source and GLB hashes before and after. Captures remain pending human visual review. Regenerate the plan after fixture/source changes; unsupported host fixtures must be supplied before those cases can pass.

## Previous geology reconciliation and world candidate proof

The previous reviewed generator SHA was `e8200209c2b9f4967bdcee8699776d9700163c3e5053523cc07376db78ba7343`. A fresh deterministic generation in `test-results/finish-geology-reconciliation` produced identical GLB hashes to that candidate:

- Sunder: `4f1630dc9f11b589110b1fbd7d4d67a9757237ec075c5cf824b823a03877e085`, 1,423,660 bytes.
- Scree: `fabdbfc49fef2287e61b6b66f1e30d0ecb5c3c0299adb1200f51c78b7286efa4`, 971,316 bytes.

`reviewed-e8200209/geology-reconciliation.json` records this check. There is no separate identified v4 candidate; do not apply that label to these bytes.

The six-angle scheduled lab helper is `npx tsx runs/corealm-rebuild/checks/finish-geology-gallery.ts`. It loads this catalogue and records its complete candidate entries and generator hash.

Two scheduled world checks use the exact same candidate GLBs through `world-geology-aliases.json`. The aliases replace current legacy semantic IDs `cliff_step_2` and `cliff_step_3` only inside the browser's manifest. They preserve production placement, dimensions, interactions and collision inputs, without promoting files or changing world source. Each invocation has a 60-second deadline:

```powershell
npx tsx runs/corealm-rebuild/checks/finish-geology-world.ts sunder_ledge
npx tsx runs/corealm-rebuild/checks/finish-geology-world.ts scree_slide
```

The checks capture front/rear/side terrain embedding, invoke normal traversal, check the authored exit and XP receipt, then walk away from the landing with normal keyboard input. Screenshots must be reviewed for unsupported rear faces or player/rock intersection even if state assertions pass. Root must then promote the exact two GLBs and native manifest rows, replace the two legacy region asset IDs, and run final production wiring proof. No promotion is authorized by CPU reconciliation alone.

## Complete exposed outcrop revision

The e8200209 world review passed both traversal/landing state checks but rejected both formations' exposed rectangular back faces. Sunder also showed an unsupported lower lip beside Highcairn's wall. The old source, catalogue and exact GLBs are preserved in `reviewed-e8200209/`; the failed visual evidence remains in `test-results/finish-geology-world`.

Actual production mesh samples showed roughly five metres of fill would be needed behind either asset. Sunder's smooth blend would intrude on Highcairn's town corner and road; Scree's existing rear points downhill. Root rejected large artificial mounds and requested complete exposed outcrops instead.

The current candidate uses tapered flank/back planes and oblique relief, while retaining its front fractures, legacy bounds and descending Scree profile. Source SHA is `465464a2c061e11cc7b485e13e93b1a9fd69433887d13821e41fee89ce86ca10`. Sunder has 30,920 triangles and Scree 20,899. `geology-reconciliation.json` records exact regenerated hashes. All 24 geometry checks pass; the separate served-byte reproduction check remains held until root promotion. These new shapes still require six-angle lab review as complete exposed outcrops before another world check.

Gallery/world helpers now create timestamped evidence directories, preserving failed runs and their source fingerprints. Rootfall's helper does the same. No public asset bytes or native world asset IDs have been promoted by this worker.

## Rootfall stair correction

The lab composition now uses the native oak stump at scale 4 and four native stone stair flights at scale 0.923834. Each flight is placed from its real centre tread heights, not the bounds that include buried masonry. The staircase points southeast at 45 degrees, with its first flight centre 8.3 m from the stump centre. This avoids the bank directly south of the world stump.

The actual GLB/Recast/Movement regression passes ascent and descent. Together with the narrow Hollowcut decorative rock removal and composition checks, all 15 focused tests pass. The hardware helper starts four metres beyond the first flight centre at measured terrain height and records that setup. It is queued for a fresh 55-second browser pass before root replaces the final-world stump and spawn.

Root rejected the wide v3 cave views for their remaining cylindrical room form. Cave geometry ownership has moved to the cave-form worker. The earlier v3 clearance evidence does not accept subsequent cave art.
