import { describe, expect, it } from "vitest";
import { lintStructures, structureCaseCount } from "../tools/lib/structure-geometry.js";

/**
 * The geometry contract every structure recipe has to keep.
 *
 * `tests/structures.test.ts` proves a recipe builds and names real assets. This proves the parts it
 * builds actually touch each other: that nothing hangs in the air, nothing is buried under the
 * ground plane, no two pieces stop just short of a joint, and no recipe reaches for a card where it
 * needs mass. Every check runs on world-space boxes derived from the shipped GLB measurements in
 * `game/public/assets/manifest.json`, across every shipped footprint, kit and variant seed.
 *
 * Run the same checks with detail: `npm run structure:lint`.
 */

/**
 * Parts that are correct in the world and unsupported in isolation.
 *
 * `vault_door` is authored against the `coldbrace_vault` tower - see the note in
 * the Fallowmarch settlement record in `content/regions.ts`, which explains why the tower cannot move. Its braziers now
 * mount on that tower's wall plane and its banners hang on the same masonry, but the tower is a
 * separate building, so in the feature lab (and here) the composition has nothing behind it. This
 * is the only structure allowed to report a floating assembly, and it is a lab-fidelity gap rather
 * than a geometry defect.
 */
const FLOATING_ALLOWLIST: Readonly<Record<string, readonly string[]>> = {
  "composition vault_door": ["torch_l", "torch_r", "banner_l", "banner_r"],
};

function allowed(key: string, tags: readonly string[]): boolean {
  for (const [prefix, permitted] of Object.entries(FLOATING_ALLOWLIST)) {
    if (!key.startsWith(prefix)) continue;
    if (tags.every((tag) => permitted.includes(tag))) return true;
  }
  return false;
}

const rows = lintStructures();

function offenders(kind: string): string[] {
  return rows.flatMap((row) => row.defects
    .filter((defect) => defect.kind === kind)
    .filter((defect) => !(kind === "FLOATING" && allowed(row.key, defect.tags)))
    .map((defect) => `${row.key} :: ${defect.tags.join(",")} :: ${defect.detail}`));
}

describe("structure geometry", () => {
  it("covers every shipped footprint, kit and variant seed", () => {
    // A guard on the guard: if the case builder ever stops enumerating, the assertions below all
    // pass vacuously.
    expect(structureCaseCount()).toBeGreaterThan(600);
    expect(structureCaseCount("composition ")).toBeGreaterThan(300);
    expect(structureCaseCount("wall-run ")).toBeGreaterThan(20);
  });

  it("never leaves an assembly hanging in the air", () => {
    expect(offenders("FLOATING")).toEqual([]);
  });

  it("never draws a part entirely below the ground plane", () => {
    expect(offenders("SUNKEN")).toEqual([]);
  });

  it("never stops a load-bearing joint just short of the piece it meets", () => {
    expect(offenders("NEAR_MISS")).toEqual([]);
  });

  it("never stands a bare masonry plane where the recipe wants mass", () => {
    expect(offenders("THIN_PLANE")).toEqual([]);
  });

  it("never stacks two copies of one asset at the same transform", () => {
    expect(offenders("DUPLICATE")).toEqual([]);
  });

  it("never names an asset the manifest does not ship", () => {
    expect(offenders("MISSING_ASSET")).toEqual([]);
  });
});
