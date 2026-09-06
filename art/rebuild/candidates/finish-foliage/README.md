# Nature candidate v10

This directory stages the complete 17-asset original nature catalogue. It does not promote assets to the game. `catalog.json` records sizes, grounded base coordinates, triangle counts, materials and SHA-256 hashes for every GLB. Original project geometry uses the existing production nature surface materials; no new external source or texture license is required.

The six living trees fix three visible mesh problems. Oak and pine lamina bases now follow the swept wood centreline instead of the straight control polygon. Oak margin lobes previously vanished because all five segment samples landed on zero crossings of their shape function. Six margin samples now preserve three distinct lobes, with fewer interior triangles. Pine needles are longer and narrower, changing their width-to-length ratio from .30 to .16. The crown coverage limits remain unchanged.

Root position hashes below .35 m, lower bole hashes below 1.8 m and all six complete production envelopes remain exact. No scatter coordinates, saved tree IDs, resource definitions, yields, depletion timers, colliders, LOD sources or materials changed. The other 11 nature assets rebuild unchanged.

## Catalogue review

| Assets | Review disposition |
| --- | --- |
| Oak 1 | Keep spreading crown and divided trunk; corrected sampled leaf lobes and attachment |
| Oak 2 | Keep broad irregular crown and visible fork windows; corrected leaf lobes and attachment |
| Oak 3 | Keep raised young crown and lighter scaffold; corrected leaf lobes and attachment |
| Pine 1 | Keep mature irregular whorls; narrow needles and correct attachment |
| Pine 2 | Keep leaning asymmetric crown; narrow needles and correct attachment |
| Pine 3 | Keep smaller lifted crown; narrow needles and correct attachment |
| Deadwood 1, Deadwood 2 | Retain source pending full close-view catalogue acceptance; no change |
| Oak stump, Pine stump | Retain existing grounded harvest substitutions; no change |
| Fern 1, Fern 2 | Retain divided fronds; no change |
| Grass 1, Grass 2 | Retain blade clumps; no change |
| Shrub 1, Shrub 2 | Retain source; no change |
| Flower 1 | Retain source; no change |

All twelve archived v2 tree overview screenshots were inspected. They show filled oak crowns and irregular conifer silhouettes, but do not establish close-view or movement acceptance. The first hardware v9 detail pass exposed the leaf shape issues fixed in v10. Final acceptance belongs to root after reviewing the v10 captures.

The corrected v10 hardware pass produced 48 images, 30 gallery/motion records and 18 scatter profiles on an RTX 5080 through ANGLE D3D11. Every gallery view waited for the correct panel selection, recorded current drawn entity bounds and rejected leftover scatter objects. Near and return cameras measured 30.4–30.8 m from the tree; far cameras measured 86.6–86.8 m. All phases submitted the exact staged tree triangle count. No page error or document reload occurred. Seven topology checks passed in 3.72 seconds; 21 forest-resource, obstacle and render-continuity checks passed in 0.57 seconds. Two v10 exports were byte-deterministic.

## Rebuild and review

```powershell
npx tsx tools/build-corealm-nature.ts --stage art/rebuild/candidates/finish-foliage
npx vitest run tests/tree-topology.test.ts
node art/rebuild/candidates/finish-foliage/review.mjs
```

Only run the browser helper during a root-assigned GPU slot. It uses the production Vite game on 4175, ANGLE D3D11 and original production lighting. Set `FOLIAGE_URL` for another stable server. Playwright intercepts the six production nature GLB URLs with staged bytes. The live manifest and public files stay untouched. It records the actual renderer and rejects software rendering.

The capture order is Oak 1, Oak 2, Oak 3, Pine 1, Pine 2, Pine 3. Each receives a front overview, a second front frame after 950 ms, an opposite overview, a close branch/leaf detail and a far overview. Output overwrites `test-results/finish-foliage/`. `report.json` records each exact source hash, triangle count, selection, bounds and document time origin. Use `--all` to extend the same sweep to the other 11 assets.

After the gallery views, each tree uses the real scatter fixture for near, far and return captures. Each phase asserts actual colour-pass triangle submissions equal the staged source catalogue. The report retains these profiles and source bounds. The screenshot pairs support movement inspection but do not independently prove wind displacement. Natural harvesting and save restoration remain separate checks. Root should run `tools/forest-lab-test.ts` for ordinary click, missing-tool response, receipt, depletion, saved stump, distant return and regrowth after debug timer expiry. Final-world harvest integration remains required after promotion.

## Promotion

After root accepts the lab images, copy only the six living tree GLBs to their matching `game/public/assets/models/corealm/nature/` paths and merge the matching six catalogue entries into the production manifest. Update `tools/data/corealm-nature.json` from this catalogue. Keep asset IDs and the existing texture/material wiring. The full-envelope and lower-trunk compatibility means no scatter, navigation, harvesting or save migration is proposed.

## Remaining public catalogue

All 11 remaining public models now have a separate 44-view hardware review and individual retain dispositions in [remaining-catalogue-review.md](remaining-catalogue-review.md). Exact reviewed hashes are preserved in [remaining-public-inventory.json](remaining-public-inventory.json). Reproduce during a root-assigned GPU slot with `node art/rebuild/candidates/finish-foliage/review.mjs --public --remaining`; this mode serves current public files without interception.
