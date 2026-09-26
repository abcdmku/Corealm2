import { describe, expect, it } from "vitest";

import {
  COMBAT_LAB_BOOT_PROFILE,
  FEATURE_LAB_BANK_ID,
} from "../game/src/app/bootProfile.js";

describe("feature-lab bank fixture", () => {
  it("boots a production bank entity with measured collision", () => {
    const heightAt = () => 9;
    const built = COMBAT_LAB_BOOT_PROFILE.buildSemanticWorld(1337, heightAt, {
      heightAt,
      baseY: () => -0.1,
      assetSize: () => ({ x: 1.28, y: 0.72, z: 0.76 }),
      assetCenterXZ: () => ({ x: 0, z: 0 }),
    });

    expect(built.entities).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: FEATURE_LAB_BANK_ID,
        archetype: "bank",
        state: "closed",
        interactions: ["inspect", "bank"],
        position: [2, 9.1, 1],
        view: expect.objectContaining({ assetId: "chest_wood" }),
      }),
    ]));
    expect(built.solids).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "box",
        id: FEATURE_LAB_BANK_ID,
        position: [2, 9.1, 1],
      }),
    ]));
    expect(built.entities.find(entity => entity.meta?.upgradeFount)?.interactions).toContain("upgrade");
  });
});
