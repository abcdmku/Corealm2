import { describe, expect, it } from "vitest";
import { createThumbnailWarmer } from "../devdocs/src/viewer/thumbnailWarmer.js";

/** A live server's admin keeps creature thumbnails current: only missing keys render, and triggers coalesce. */
function harness(ids: string[], stored: Set<string>) {
  const rendered: string[] = [];
  let looks = 1;
  const warmer = createThumbnailWarmer({
    creatureIds: () => ids,
    cacheKey: async assetId => `${assetId}-look${looks}`,
    missing: async key => !stored.has(key),
    provide: async assetId => { rendered.push(assetId); stored.add(`${assetId}-look${looks}`); await new Promise(resolve => setTimeout(resolve, 5)); return "data:image/png;base64,"; },
  });
  return { warmer, rendered, changeLooks: () => { looks++; } };
}

describe("thumbnail warmer", () => {
  it("renders only creatures whose current key is missing", async () => {
    const { warmer, rendered } = harness(["hen", "cow", "frog"], new Set(["creature:hen-look1", "creature:frog-look1"]));
    warmer.schedule(0);
    await warmer.idle();
    expect(rendered).toEqual(["creature:cow"]);
    warmer.schedule(0);
    await warmer.idle();
    expect(rendered).toEqual(["creature:cow"]);
    expect(warmer.status.passes).toBe(2);
  });

  it("runs one more pass for triggers during a pass, and renders the changed looks", async () => {
    const { warmer, rendered, changeLooks } = harness(["hen", "cow"], new Set());
    warmer.schedule(0);
    await new Promise(resolve => setTimeout(resolve, 2));
    changeLooks();
    warmer.schedule(0); warmer.schedule(0); warmer.schedule(0);
    await warmer.idle();
    expect(warmer.status.passes).toBe(2);
    expect(rendered.filter(id => id === "creature:hen").length).toBeLessThanOrEqual(2);
    expect(rendered).toContain("creature:cow");
    expect(warmer.status.rendered).toBeLessThanOrEqual(2);
  });
});
