import { describe, expect, it } from "vitest";
import rawParams from "../game/content/data/balance/gearProgression.json";
import rawRecipes from "../game/content/data/balance/recipes.json";
import { ITEM_RECORDS } from "../game/src/content/itemData.js";
import { CRAFTING_TIER_RECORDS } from "../game/src/content/craftingTierData.js";
import { gearProgression, interpolateGearProgression } from "../game/src/content/balance/gearProgression.js";
import { recipesBalanceSchema } from "../game/src/content/schema/balance.js";
import { GearProgressionBalanceSchema, GearProgressionDerivationSchema, type GearProgressionDerivation } from "../game/src/content/schema/gearProgression.js";
import { parseValue } from "../game/src/content/schema/core.js";
import { buildGearProgressionTags, gearProgressionFields } from "../tools/content/gear-progression-derivations.js";

const params = parseValue(GearProgressionBalanceSchema, rawParams, "gearProgression");
const recipes = parseValue(recipesBalanceSchema, rawRecipes, "recipes");
const proposals = buildGearProgressionTags(params, recipes, CRAFTING_TIER_RECORDS, ITEM_RECORDS);
const tag = (id: string): GearProgressionDerivation => proposals.find(row => row.itemId === id)!.derivation;

describe("regional and Wilderness gear progression", () => {
  it("recomputes all 88 original equipment and tool rows without rewriting any item field", () => {
    const before = structuredClone(ITEM_RECORDS);
    expect(proposals).toHaveLength(88);
    expect(proposals.filter(row => row.derivation.catalog === "REGIONAL_TIER_ITEMS")).toHaveLength(51);
    expect(proposals.filter(row => row.derivation.catalog === "WILDERNESS_LOOT_ITEMS")).toHaveLength(37);
    for (const { itemId, derivation } of proposals) {
      const item = ITEM_RECORDS.find(row => row.id === itemId)!;
      expect(gearProgression(params, recipes, derivation), itemId).toEqual(gearProgressionFields(item));
      expect(Object.keys(derivation).sort()).toEqual(["catalog", "kind", "ladderTier", "role"]);
    }
    expect(ITEM_RECORDS).toEqual(before);
  });

  it("preserves interpolation checkpoints, segment selection and one final rounding", () => {
    expect(interpolateGearProgression(30, [20, 50, 70], [3200, 8200, 13700])).toBe(4867);
    expect(interpolateGearProgression(60, [20, 50, 70], [3200, 8200, 13700])).toBe(10950);
    expect(interpolateGearProgression(50, [20, 50, 70], [1, 9, 30])).toBe(9);
    const edited = structuredClone(params);
    const sword = edited.regional.gear.find(row => row.role === "metal_sword")!;
    sword.stats[0].meleePower = 99;
    sword.values = [5000, sword.values[1], sword.values[2]];
    const result = gearProgression(edited, recipes, tag("dewglass_sword"));
    expect(result.equip!.bonuses.meleePower).toBe(97);
    expect(result.value).toBe(6067);
    expect(gearProgression(edited, recipes, tag("cindersteel_sword"))).toEqual(gearProgression(params, recipes, tag("cindersteel_sword")));
  });

  it("retains both original Math.max operands in Wilderness ladder and special stats", () => {
    const edited = structuredClone(params);
    const shield = edited.wilderness.gear.find(row => row.role === "wood_shield")!;
    expect(shield.stats.defence).toEqual({ maxPairs: [[43, 56], [19, 25]] });
    if (!shield.stats.defence || !("maxPairs" in shield.stats.defence)) throw new Error("Missing shield operands");
    shield.stats.defence.maxPairs = [shield.stats.defence.maxPairs[0], [100, shield.stats.defence.maxPairs[1][1]]];
    expect(gearProgression(edited, recipes, tag("teak_shield")).equip!.bonuses.defence).toBe(100);
    expect(gearProgression(edited, recipes, tag("magic_shield")).equip!.bonuses.defence).toBe(56);
    const guard = edited.wilderness.specialGear.find(row => row.role === "ashseal_guard")!;
    expect(guard.stats.defence).toEqual({ max: [57, 25] });
    if (!guard.stats.defence || !("max" in guard.stats.defence)) throw new Error("Missing guard operands");
    guard.stats.defence.max = [guard.stats.defence.max[0], 120];
    expect(gearProgression(edited, recipes, tag("ashseal_guard")).equip!.bonuses.defence).toBe(120);
  });

  it("reads tool arithmetic, weapon cadence and hand count from independent parameters", () => {
    const editedRecipes = structuredClone(recipes);
    editedRecipes.toolBonus.maximum = 999;
    editedRecipes.toolBonus.base = 7;
    editedRecipes.toolBonus.perTier = 2;
    expect(gearProgression(params, editedRecipes, tag("dewglass_pickaxe")).tool!.gatherBonus).toBe(67);
    expect(gearProgression(params, editedRecipes, tag("nightglass_hatchet")).tool!.gatherBonus).toBe(147);
    const edited = structuredClone(params);
    edited.weaponProfiles.staff.attackSpeedMs = 4100;
    edited.weaponProfiles.staff.hands = 1;
    const result = gearProgression(edited, recipes, tag("hollowstar_staff"));
    expect(result.equip!.attackSpeedMs).toBe(4100);
    expect(result.magicWeapon).toEqual({ kind: "staff", hands: 1 });
    expect(gearProgression(edited, recipes, tag("nightmarshal_plate")).equip).not.toHaveProperty("attackSpeedMs");
  });

  it("preserves optional field absence and refuses target shape drift", () => {
    expect(gearProgression(params, recipes, tag("willow_rod"))).not.toHaveProperty("equip");
    expect(gearProgression(params, recipes, tag("dewglass_sword"))).not.toHaveProperty("magicWeapon");
    expect(gearProgression(params, recipes, tag("willow_staff"))).not.toHaveProperty("tool");
    const changed = ITEM_RECORDS.map(row => row.id === "dewglass_sword"
      ? { ...row, tool: { skill: "mining" as const, gatherBonus: 1 } } : row);
    expect(() => buildGearProgressionTags(params, recipes, CRAFTING_TIER_RECORDS, changed)).toThrow("Cannot tag drifted progression gear");
    expect(() => buildGearProgressionTags(params, recipes, CRAFTING_TIER_RECORDS, ITEM_RECORDS.filter(row => row.id !== "willow_rod"))).toThrow("Missing progression item");
    expect(() => gearProgression(params, recipes, { kind: "gearProgression", catalog: "WILDERNESS_LOOT_ITEMS", ladderTier: 70, role: "ashseal_guard" })).toThrow("Wrong tier");
  });

  it("rejects malformed tags, numeric parameters, unknown fields and duplicate roles", () => {
    expect(() => parseValue(GearProgressionDerivationSchema, { ...tag("dewglass_sword"), bonuses: {} }, "tag")).toThrow();
    expect(() => parseValue(GearProgressionDerivationSchema, { ...tag("dewglass_sword"), ladderTier: 50 }, "tag")).toThrow();
    expect(() => parseValue(GearProgressionDerivationSchema, { ...tag("teak_shield"), role: "rod" }, "tag")).toThrow();
    const duplicate = structuredClone(rawParams);
    duplicate.regional.gear[1] = duplicate.regional.gear[0]!;
    expect(() => parseValue(GearProgressionBalanceSchema, duplicate, "params")).toThrow("exactly once");
    expect(() => parseValue(GearProgressionBalanceSchema, { ...rawParams,
      regional: { ...rawParams.regional, checkpointTiers: [50, 20, 70] } }, "params")).toThrow("must increase");
    expect(() => parseValue(GearProgressionBalanceSchema, { ...rawParams,
      weaponProfiles: { ...rawParams.weaponProfiles, sword: { attackSpeedMs: 0 } } }, "params")).toThrow();
  });
});
