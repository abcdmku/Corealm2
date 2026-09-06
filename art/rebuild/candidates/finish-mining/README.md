# Mining candidates, 2026-09-05

Status: 79 focused checks pass. Current staged ore gallery and six compact extraction probes pass. Root has accepted the copper direction; full catalogue promotion remains root-owned. No assets were promoted to public by this worker. Final-world composition and access remain unproved.

The generator now clips the isotropic exposure field at 0.47 across all six families. This removes the iron candidate's connected 0.6304 m fleck. The unchanged regression requires every connected mineral patch to span less than 0.55 m, at least 13 patches per family, and 0.1–4% mineral surface coverage. Current active coverage is 1.17–1.96%. All twelve active/spent GLBs use the muted stone albedo, normal strength 0.16, matte materials, and zero emission. They retain grounded closed bodies and matching active/spent footprints.

Focused validation completed:

```powershell
npx vitest run tests/ground-ores.test.ts tests/mining-access.test.ts tests/mining-interaction-access.test.ts tests/site-terrain.test.ts
```

Result: 51 passed. The material/export check now inspects all twelve GLBs instead of copper alone. The guard on output paths permits only test-results or this exact candidate package and its children.

Regenerate candidates:

```powershell
npx tsx tools/build-ground-ores.ts --out art/rebuild/candidates/finish-mining
```

The existing assetCandidates helper reads ground-ores.json and verifies byte count and SHA-256 before intercepting model and manifest requests in one browser context. It leaves the public manifest untouched.

## Root browser queue

Run sequentially, beginning with copper, on the root's stable server at 4175. Each command has the existing 60 second proof budget.

```powershell
npx tsx runs/corealm-rebuild/checks/native-prop-review.ts --catalog art/rebuild/candidates/finish-mining/ground-ores.json --out test-results/finish-mining/copper corealm_ore_grithe corealm_ore_grithe_spent
npx tsx runs/corealm-rebuild/checks/native-prop-review.ts --catalog art/rebuild/candidates/finish-mining/ground-ores.json --out test-results/finish-mining/iron corealm_ore_corven corealm_ore_corven_spent
npx tsx runs/corealm-rebuild/checks/native-prop-review.ts --catalog art/rebuild/candidates/finish-mining/ground-ores.json --out test-results/finish-mining/remaining corealm_ore_kaldite corealm_ore_kaldite_spent corealm_ore_emberite corealm_ore_emberite_spent corealm_ore_stone corealm_ore_stone_spent corealm_ore_kilnstone corealm_ore_kilnstone_spent
npx tsx runs/corealm-rebuild/checks/mine-access-browser.ts --url http://127.0.0.1:4175 --mode lab --site bracken_workings --cut-face --catalog art/rebuild/candidates/finish-mining/ground-ores.json --out test-results/finish-mining/cut-face
```

Inspect each primary/opposite model capture and the mine-wide/working-close captures. Then repeat the mine-access command without --cut-face for bracken_workings, hollowcut_workings, lower_quarry_bench, upper_seam_shelf and clinker_cut, each with a unique output directory. The access probe checks every stance and approach route; use --entity with each site resource ID to repeat real extraction for individual rocks. The default extracts from the middle rock.

After root accepts local proof, merge mining stances with fishing in boot's game-only worldPorts.accessPositions:

```typescript
new Map([
  ...fishingAccessPositions(WORLD_SITES, scene.getWaterBodies(), (x, z) => scene.meshHeightAt(x, z)),
  ...miningAccessPositions(WORLD_SITES, (x, z) => scene.meshHeightAt(x, z), {
    assetSize: (id) => assets.assetSize(id),
    assetCenterXZ: (id) => assets.assetCenterXZ(id),
  }),
])
```

Import miningAccessPositions from ./miningAccess.js. Repeat the five site commands with --mode world only after integration. World placement qualifies for the world-only exception because the final terrain, navmesh, neighboring portal and regional roads cannot be proven in the compact fixture. This exception does not accept the boulder art or local extraction behavior.

No siteTerrain or mineCutFace change was needed by the passing focused checks. Their final-world clearance and Upper Seam grade still need the browser proof above.

## Audit follow-up

The mine findings in runs/corealm-rebuild/world-finish-audit.md refer to test-results/world-art-current images from September 4 at 21:19. Those images visibly show the wide crown, wall-mounted ore, and severe Upper Seam triangular end fins. They remain rejection evidence for that revision.

Current mineCutFace.ts has a later final-section pass that shrinks terminal depth to 1.2% and buries each endcap vertex at least 0.10 m below the sampled terrain. It also moves the roof into terrain and derives collision from the resulting geometry. Existing flat and steep fixture regressions cover terminal width, burial and exposed collision containment. The old audit's claim that terminal depth is not tapered is stale for this source.

September 5 Bracken and Hollowcut lab images under test-results/mine-ground-review show separate ground ores and tapered foreground cut faces. They still show repeated wall beds and separate tall rear dressing. They do not prove final terrain embedding, normal-world camera clearance or the other three mines. They also predate the latest quiet ore candidates. No fresh art acceptance is claimed.

Additional focused checks passed: 28 tests in mine-cut-face, mine-haul-ramp and mine-access-layout. Combined with the earlier 51, this is 79 focused mining checks. No source deformation was added based on old screenshots.

The new tools/mining-finish-review.ts captures front and both oblique views through production showSite and the staged candidate interceptor. Its --help command was checked; no browser was launched while the GPU queue was occupied. Run each separately:

```powershell
npx tsx tools/mining-finish-review.ts --site bracken_workings
npx tsx tools/mining-finish-review.ts --site hollowcut_workings
npx tsx tools/mining-finish-review.ts --site lower_quarry_bench
npx tsx tools/mining-finish-review.ts --site upper_seam_shelf
npx tsx tools/mining-finish-review.ts --site clinker_cut
```

Each uses the stable 4175 server by default and writes test-results/finish-mining/views/<site-id>. Use --url to change the server. These are detached inspection cameras for art review. The separate mine-access-browser proof must establish normal camera behavior, route clearance and resource receipts.


## Fresh compact browser evidence

On September 5, the scheduled exclusive GPU slot completed the following against the stable 4175 server. Every launched browser was closed before releasing the slot.

- All twelve active/spent ores, primary and opposite captures: test-results/finish-mining/copper and test-results/finish-mining/remaining. All 24 screenshots inspected. Quiet matte stone, bounded scattered mineral patches, unchanged active/spent silhouette. Recommend root promotion of this catalogue.
- All five compact production sites, front/left/right captures: test-results/finish-mining/views/<site>. All 15 screenshots inspected. Ground ores and working aisles are readable. Squared rear dressing and triangular shoulder roof surfaces remain exposed in the flat fixture; actual production terrain embedding must determine which surfaces remain visible. These pictures do not accept final site geology.
- Real pointer extraction in all five compact sites plus the isolated two-rock showCutFace fixture: test-results/finish-mining/extract/<site>/report.json and /cut-face/report.json. All pass. Each site checked every ore stance and approach path, then clicked the representative target and received one normal inventory item while remaining yield decreased by one. Working-close screenshots inspected. No clock acceleration or resource mutation supplied the receipt.

| Site | Clicked resource | Travel | Remaining |
| --- | --- | --- | --- |
| Bracken | bracken_pit_grithe_5 | 16.92 m | 8 to 7 |
| Hollowcut | hollowcut_corven_3 | 15.66 m | 8 to 7 |
| Lower Quarry | lower_quarry_kaldite_3 | 17.76 m | 8 to 7 |
| Upper Seam | upper_karrow_kaldite_2 | 12.24 m | 8 to 7 |
| Clinker | clinker_emberite_5 | 17.76 m | 7 to 6 |

Each report records zero access failures and the actual before/after inventory. This is one real extraction per compact site, not every resource's full depletion/respawn lifecycle and not final-world acceptance.

## Public-asset integration queue

Root promoted all twelve ore candidates after the fresh catalogue review and compact extraction proofs, and merged measured mining access with fishing in game boot. The following commands intentionally omit --catalog so they use the public manifest and GLBs. Run sequentially only in an assigned GPU slot:

```powershell
npx tsx runs/corealm-rebuild/checks/mine-access-browser.ts --mode world --site bracken_workings --out test-results/finish-mining/world/bracken_workings
npx tsx runs/corealm-rebuild/checks/mine-access-browser.ts --mode world --site hollowcut_workings --out test-results/finish-mining/world/hollowcut_workings
npx tsx runs/corealm-rebuild/checks/mine-access-browser.ts --mode world --site lower_quarry_bench --out test-results/finish-mining/world/lower_quarry_bench
npx tsx runs/corealm-rebuild/checks/mine-access-browser.ts --mode world --site upper_seam_shelf --out test-results/finish-mining/world/upper_seam_shelf
npx tsx runs/corealm-rebuild/checks/mine-access-browser.ts --mode world --site clinker_cut --out test-results/finish-mining/world/clinker_cut
```

The probe checks all authored rock stances and navigation corridors in the same loaded production generation, then proves a normal pointer extraction at the representative rock. Geology composition is still unaccepted until these final embedded views are inspected.

Promotion exposed two stale focused-test assumptions, now repaired. The off-centre bounds test compares identical model dimensions with different source centres, independent of public art dimensions. The authored circulation test computes a lane outside each site's maximum model depth instead of using the old 2.1 m wall-slab offset. Its 0.85 m corridor and 1.8 m haul guards are unchanged. Five added tests connect the broad lane to every actual production working position using buildWorld-selected public model sizes and rounded scales, retaining the 0.55 m body/nav clearance. Runtime mining poses remain 0.70 m beyond the visible front. Fifty layout/access/interaction/terrain/haul checks pass after these changes.

## Authored world results, September 5

Fresh exclusive GPU batches used public assets, verified hardware D3D11, and retained the 59.5-second cap per site. Valid reports in `test-results/finish-mining/world/`:

| Directory | Result | Duration |
| --- | --- | --- |
| bracken_workings-v3 | All stance routes, actual extraction and physical haul return pass | 27.396 s |
| hollowcut_workings | Haul endpoint cannot reach apron or ore through navmesh | 17.718 s |
| lower_quarry_bench-v2 | All stance routes, actual extraction and physical haul return pass | 29.304 s |
| upper_seam_shelf | All stance routes, actual extraction and physical haul return pass | 25.739 s |
| clinker_cut | All stance routes, actual extraction and physical haul return pass | 27.654 s |

`bracken_workings-v2` is explicitly invalid concurrent GPU evidence. Earlier Lower Quarry report stopped at an unrelated missing THREE import, since fixed by the performance owner. Neither is acceptance evidence.

All current wide/close/return images were inspected. Geology is rejected: the rear bank cuts through extended stone roofs and separate authored cliff dressing stands as rectangular slabs on the crest. A source correction now buries the generated roof within 0.70–1.0 m behind its lip rather than a fraction of the full 10 m rear shell. Eight focused cut-face tests pass, including new deep-shell burial coverage; fresh compact and embedded screenshots remain necessary.

Hollowcut CPU reproduction uses the production terrain specification. Its haul endpoint falls inside Rootfall's raised pad. Natural centre height 2.018984 m versus pre-site flattened centre 5.514059 m leaves the current floor at 0.473984 m against an 8.287294 m endpoint. Peak ramp grade is 1.042501. Anchoring the cut to pre-site support lowers peak grade to 0.609674 without moving endpoints. Root wired the optional pre-site support sampler into the production scene. A regression preserves the endpoint and requires fitted grade below 0.65; fresh real-route acceptance remains pending.

The working-close frames show an active mining timer with a broad blade-like head. Equipment source and asset review indicates this may be the pick head seen face-on; no sword substitution is established. The next helper run records live rig attachment/loading/error state, requires a loaded pickaxe attachment, and captures a side angle. Receipts alone do not establish visible pick contact.

Generator reconciliation regenerated all twelve models with current source into `test-results/finish-mining/reproduce-current/`. Every GLB exactly matches both the accepted staged candidate and public model. `byte-reproduction.json` records all three hashes per model. Root repinned generator provenance from `c524e6d1a5783092af4ce4b94f778b0ba66e4707791954312d33597c19b168ff` to `bc2bdb5fad56a2eeab4a15b7398689d77fd9d4236d7c015280fda79ab5c4b448` after reviewing this receipt; no model bytes changed. Exact source-text drift remains unidentified.

## Fresh world batch 20260905-145335

Reports and four-frame site sets live in `test-results/finish-mining/world-20260905-145335/`. All browsers closed and the GPU lease was explicitly released. Bracken passed in 28.797 s, Lower in 31.944 s, Upper in 26.502 s and Clinker in 27.764 s. All four prove loaded `equip-mainHand-pickaxe` attachments without errors, actual receipts and physical return; side images clearly show the pickaxe. The former sword concern is resolved.

Hollowcut failed in 23.359 s. The support fix restores navmesh connectivity, but the chosen path intersects `root_tunnel#root_c_rock_l`. A CPU build with public measurements reproduces the exact 0.6442804515 m push at [85.45292, 8.243, 135.83072]. The decorative box is at [85.33, 6.71, 135.27], size [1.71, 1.06, 1.39], yaw -1.5708. Root was given the exact source in Root Tunnel variant C for integration.

Rear dressing removal cleared the large crest slabs. Repeated triangular rear patches remain, so geology remains rejected. Source diagnosis found the closed shell underside was a single long chord joining front and rear feet; curved terrain exposed that underside. It now follows 32 buried terrain samples. A new double-sided ray regression over a curved 2 m triangular heightfield verifies over 90 probes and closed-shell topology. Nine cut-face tests pass. These underside changes postdate this browser batch and require fresh screenshots.

Structures removed only Root Tunnel variant C's `root_c_rock_l`. `tests/hollowcut-mine-route.test.ts` now builds the actual production terrain specification, world seed 1337 and public asset measurements, checks four retained failed route samples against all production solids with unchanged 0.35 m body radius and 0.02 m shift guard, and requires the authored approach grade below 0.65. It passes. The underside correction has nine passing cut-face tests; terrain/haul/cut-face checks total 26. Final browser route and embedding proof remain pending.

## Underside browser round and triangle-sampler correction

`test-results/finish-mining/world-20260905-final-underside/` retains the next exclusive GPU batch: Bracken 27.564 s, Lower 29.753 s, Upper 26.705 s and Clinker 27.317 s pass movement/extraction/tool/return assertions. Hollowcut now passes routes and extraction but its return click selected `rootfall_postern#hb_1`, walking safely to a different endpoint. Its 42.326 s failed report remains diagnostic evidence. The helper now verifies stable ground hover, a clear terrain sightline and the actual movement destination, trying bounded camera angles without changing the haul endpoint.

Geology still showed rear patches, and a direct request to port 4175 confirmed the current underside source was served. Further inspection found `meshHeightAt` is bilinear while terrain meshes use indexed triangles. On a saddle these surfaces differ substantially. Mine burial now reads the actual terrain mesh grid and triangle indices without changing station crest anchors or gameplay height semantics. A ray comparison tests both index diagonals, including a two-metre difference from bilinear height. Ten cut-face tests pass. Fresh five-site embedding remains required; no visual acceptance is inferred from the four route passes.
