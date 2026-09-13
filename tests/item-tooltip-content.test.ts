import { beforeAll, describe, expect, it } from "vitest";
import { content } from "../game/src/content/index.js";
import { ALL_ITEMS } from "../game/src/content/items.js";
import { itemTooltipContent } from "../game/src/ui/itemTooltipContent.js";

beforeAll(() => content.register({ items: ALL_ITEMS }));

describe("shared item tooltip content", () => {
  it("keeps the neutral docs card free of invented player state", () => {
    const model = itemTooltipContent("grithe_sword");
    expect(model.title).toBe("Copper Sword");
    expect(model.description).toBe(ALL_ITEMS.find((item) => item.id === "grithe_sword")?.description);
    expect(model.stats.length).toBeGreaterThan(0);
    expect(model.requirements).toContainEqual({ text: "Requires Melee 1" });
    expect(JSON.stringify(model)).not.toContain("you have");
  });

  it("adds live requirement and equipment comparisons for the game", () => {
    const model = itemTooltipContent("grithe_sword", {
      skillLevels: { melee: 0 },
      wornBonuses: {
        meleeAccuracy: 99, meleePower: 0,  magicAccuracy: 0,
        magicPower: 0, defence: 0, health: 0, vitality: 0 },
      comparedSlotLabel: "main hand",
    });
    expect(model.requirements).toContainEqual({ text: "Requires Melee 1 — you have 0", met: false });
    expect(model.stats.some((stat) => stat.delta !== undefined)).toBe(true);
    expect(model.details).toContain("Compared with your main hand.");
  });

  it("reports canonical magic charge facts", () => {
    const model = itemTooltipContent("air_wand", { liveWeaponCharges: 37 });
    expect(model.details).toContain("Air weapon · 37 / 1,000 charges remaining.");
    expect(model.details).toContain("100 Air Essence at an Essence Altar refills it.");
  });
});
