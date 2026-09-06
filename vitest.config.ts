import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // `art/rebuild/candidates` is a review archive of staged and rejected work, not project source.
    // Vitest's default glob collected the snapshots' own test files, so a superseded copy sitting
    // next to its candidate kept asserting the values it was frozen with and failed the suite long
    // after `tests/` had taken over its coverage. Archives never contribute test results.
    exclude: ["**/node_modules/**", "**/dist/**", "art/**", "runs/**"],
    // Much of this suite regenerates real assets — geology, minerals, ores, cave shells, creature
    // rigs — which takes seconds per test by design. Against the 5 s default those tests failed
    // only when the whole suite competed for cores, so the release gate reported defects that
    // reruns could not reproduce. These budgets are for scheduling noise on a loaded machine; a
    // test that genuinely hangs still fails, just later.
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
