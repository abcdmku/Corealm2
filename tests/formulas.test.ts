import { describe, expect, it } from "vitest";
import {
  agilitySuccessChance, agilityXp, burnChance, gatherSuccessChance, gatherXp,
  healAmount, recipeXp, respawnSeconds, sellPrice, toolBonus, yieldRange,
} from "../game/src/content/index.js";

/**
 * The PRD's numbers, frozen as tests.
 *
 * Every one of these appears in a worked example the content and systems were authored against, so
 * a refactor that quietly moves one would silently rebalance the game.
 */
describe("gathering", () => {
  it("is exactly 30% at the node's own level and caps at 95%", () => {
    expect(gatherSuccessChance(1, 1)).toBeCloseTo(0.3, 10);
    expect(gatherSuccessChance(10, 10)).toBeCloseTo(0.3, 10);
    expect(gatherSuccessChance(51, 10)).toBeCloseTo(0.95, 10);
    expect(gatherSuccessChance(200, 10)).toBeCloseTo(0.95, 10);
    expect(gatherSuccessChance(1, 99)).toBeCloseTo(0.05, 10);
  });

  it("awards the PRD's XP per yield", () => {
    expect(gatherXp(1)).toBe(10);
    expect(gatherXp(5)).toBe(24);
    expect(gatherXp(10)).toBe(35);
    expect(gatherXp(50)).toBe(86);
    expect(gatherXp(99)).toBe(125);
  });

  it("matches the brief's yield bands after the root's tier-1 correction", () => {
    expect(yieldRange(1)).toEqual([8, 15]);
    expect(yieldRange(5)).toEqual([8, 15]);
    expect(yieldRange(10)).toEqual([8, 14]);
    expect(yieldRange(50)).toEqual([6, 12]);
    expect(yieldRange(99)).toEqual([4, 10]);
  });

  it("respawns on the PRD's timers", () => {
    expect(respawnSeconds(1)).toBe(21);
    expect(respawnSeconds(5)).toBe(32);
    expect(respawnSeconds(10)).toBe(43);
    expect(respawnSeconds(99)).toBe(218);
  });

  it("gives tools the documented effective-level bonus, capped at 40", () => {
    expect(toolBonus(1)).toBe(2);
    expect(toolBonus(5)).toBe(5);
    expect(toolBonus(10)).toBe(9);
    expect(toolBonus(99)).toBe(40);
  });
});

describe("production", () => {
  it("reproduces the PRD's worked recipe XP", () => {
    expect(recipeXp(1, 0.8)).toBe(8);    // Grithe bar
    expect(recipeXp(1, 3.5)).toBe(35);   // Grithe sword
    expect(recipeXp(10, 0.8)).toBe(28);  // Kaldite bar
    expect(recipeXp(10, 5.0)).toBe(175); // Kaldite body
  });

  it("burns until 15 levels above the requirement", () => {
    expect(burnChance(1, 1)).toBeCloseTo(0.45, 10);
    expect(burnChance(16, 1)).toBeCloseTo(0, 10);
    expect(burnChance(40, 1)).toBeCloseTo(0, 10);
  });

  it("heals by the tier formula", () => {
    // The PRD prose says tier 10 heals 11; the formula gives round(11.56) = 12.
    // The formula is authoritative because every food item is generated from it.
    expect(healAmount(1)).toBe(3);
    expect(healAmount(5)).toBe(7);
    expect(healAmount(10)).toBe(12);
    // The PRD prose says 70 at tier 99; round(2 + 1.35 * 99^0.85) is 69.04, so 69. Nothing in
    // Phase 1 reaches tier 99 and the formula is what generates every food item, so it wins.
    expect(healAmount(99)).toBe(69);
  });

  it("sells at 60% of value", () => {
    expect(sellPrice(100)).toBe(60);
    expect(sellPrice(1)).toBe(1);
  });
});

describe("agility", () => {
  it("awards 1.8x the gather rate", () => {
    expect(agilityXp(1)).toBe(18);
    expect(agilityXp(5)).toBe(43);
    expect(agilityXp(10)).toBe(63);
  });

  it("never drops below a coin flip and caps at certainty", () => {
    expect(agilitySuccessChance(1, 1)).toBeCloseTo(0.6, 10);
    expect(agilitySuccessChance(1, 99)).toBeCloseTo(0.5, 10);
    expect(agilitySuccessChance(99, 1)).toBeCloseTo(1, 10);
  });
});
