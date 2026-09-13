# Full-suite failure repairs

The bounded baseline reproduced 31 test failures and one failed suite import, with no timeouts. Repairs preserve the existing equipment reskin scope and add no model assets.

Production changes:

- Far Lake and White Castle approaches use gentler authored waypoints. Their maximum grades are 42.38 and 32.03 degrees; the existing 60-degree climb limit and protected foundations remain unchanged.
- Cairn Tarn's fitted outer bank owns the downhill return instead of being raised again by the generic terrain blend. A continuous profile spreads its descent while preserving the lake level, footprint, crest and receiving hillside slope.
- An inactive porcupine pack plan moves one metre west, restoring the existing one-metre cave-shell clearance. No live creature placement changes.
- Miniboss jewelry descriptions use player-facing language without equating content tiers with creature combat levels.

Test corrections identify lakes by stable IDs, distinguish channel fisheries from closed basins, measure exact lava banks, populate current mock fields, and use authored mine and chamber fixtures. Legacy icon model coverage accommodates reviewed generated art. Creature checks retain accepted Crownward native locomotion and prove that the worm's entire skeleton supports belly contacts, making its existing recoil exclusion intentional. All other creature masks remain required.

The Cairn check retains the 4.2-metre fill limit and 60% relative slope reduction. At each half-metre sample it allows at most the original 1.2 grade cap or that sample's existing native grade, whichever is larger. This prevents the fitted bank from amplifying naturally steep ground. A separate regression checks continuous heights and derivatives, monotone descent and bounded slope.

Vitest now uses at most four workers to keep asset-heavy tests within their local deadlines. The public recoil inventory checks every asset in batches of 24, then verifies complete coverage with no duplicate or missing IDs. This replaces a single 184-asset loop that exceeded its 30-second deadline under suite load. Existing test deadlines and the existing skipped test remain unchanged.

The terrain and authored road changes use the documented final-world exception to lab-first testing because their receiving hillsides and foundations are world-specific. The combined production lab gate passed in 54.5 seconds. Fresh read-only source review accepted the test and production changes. Full-world checks use ordinary player-follow camera settings, actual fishing depletion and real navigation; screenshots and reports remain disposable under `test-results/failure-repair-world/`.

Final validation: `npm test` passes all 373 files, with 2,852 tests passed and one existing skip, in 116.34 seconds. Typecheck, the refreshed production build, documentation build and 533-page link check pass. Cairn fishing depleted its school from 12 to 11; both repaired road checks arrived through real navigation. Root reviewed the shoreline, bank and road screenshots. Disposable logs and screenshots were recycled during the subsequent requested cleanup; the tests and `tools/failure-repair-world-test.ts` remain available to reproduce them.
