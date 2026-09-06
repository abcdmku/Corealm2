import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // `art/rebuild/candidates` is a review archive of staged and rejected work, not project source.
    // Vitest's default glob collected the snapshots' own test files, so a superseded copy sitting
    // next to its candidate kept asserting the values it was frozen with and failed the suite long
    // after `tests/` had taken over its coverage. Archives never contribute test results.
    exclude: ["**/node_modules/**", "**/dist/**", "art/**", "runs/**"],
  },
});
