import { describe, expect, it } from "vitest";
import { dropPerKill, formatChance, lootOdds, rollOdds } from "../devdocs/src/model/loot.js";

const drop = (itemId: string, chance: number) => ({ itemId, quantity: [1, 1] as [number, number], chance });

describe("loot odds", () => {
  it("adds a pool's chances per roll and compounds its repeats per kill", () => {
    const odds = rollOdds({ count: 2, drops: [drop("limestone", 0.3), drop("quartz", 0.2)] });
    expect(odds.perRoll).toBeCloseTo(0.5);
    expect(odds.any).toBeCloseTo(0.75);
    expect(odds.stacks).toBeCloseTo(1);
  });

  it("combines independent roll groups into one kill", () => {
    const odds = lootOdds([
      { count: 1, drops: [drop("limestone", 0.5)] },
      { count: 1, drops: [drop("worn_helm", 0.5), drop("limestone", 0.1)] },
    ]);
    expect(odds.any).toBeCloseTo(0.8);
    expect(odds.stacks).toBeCloseTo(1.1);
    expect(odds.items).toBe(2);
    expect(odds.rolls).toBe(2);
  });

  it("drops nothing from no rolls", () => {
    expect(lootOdds([])).toEqual({ any: 0, stacks: 0, items: 0, rolls: 0 });
  });

  it("gives one item's chance over repeated rolls", () => {
    expect(dropPerKill(0.5, 2)).toBeCloseTo(0.75);
    expect(dropPerKill(0.05, 1)).toBeCloseTo(0.05);
  });

  it("keeps rare chances readable", () => {
    expect(formatChance(0.45)).toBe("45%");
    expect(formatChance(0.125)).toBe("12.5%");
    expect(formatChance(0.005)).toBe("0.5%");
    expect(formatChance(0.0004)).toBe("0.04%");
    expect(formatChance(0)).toBe("0%");
    expect(formatChance(1)).toBe("100%");
  });
});
