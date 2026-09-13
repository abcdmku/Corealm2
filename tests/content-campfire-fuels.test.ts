import { describe, expect, it } from "vitest";
import rawCampfireParameters from "../game/content/data/balance/campfires.json";
import rawRecipeParameters from "../game/content/data/balance/recipes.json";
import rawCampfireFuels from "../game/content/data/campfireFuels.json";
import {
  CAMPFIRE_FUEL_RECORDS, CAMPFIRE_FUELS, campfireFuelByLog,
} from "../game/src/content/campfireData.js";
import { GATHERING_PRODUCTION_TIERS } from "../game/src/content/gatheringProductionTiers.js";
import { campfireFuel } from "../game/src/content/balance/campfires.js";
import { CampfireFuelDerivationSchema, CampfireFuelRecordSchema, CampfireFuelSchema } from "../game/src/content/schema/campfireFuels.js";
import { campfiresBalanceSchema, recipesBalanceSchema } from "../game/src/content/schema/balance.js";
import { parseCollection, parseValue } from "../game/src/content/schema/core.js";
import type { CampfireFuelDef } from "../game/src/content/index.js";
import { buildCampfireFuelRecords } from "../tools/content/export-campfire-fuels.js";

const campfireParameters = parseValue(campfiresBalanceSchema, rawCampfireParameters, "balance/campfires");
const recipeParameters = parseValue(recipesBalanceSchema, rawRecipeParameters, "balance/recipes");
const logOrder = [
  "palewood_log", "duskoak_log", "cairnpine_log", "cinderpine_log",
  "willow_log", "maple_log", "teak_log", "yew_log", "magic_log",
];

describe("campfire fuel JSON content", () => {
  it("loads the canonical nine-row table and strips derivation metadata at runtime", () => {
    expect(CAMPFIRE_FUEL_RECORDS.map((row) => row.logItemId)).toEqual(logOrder);
    expect(CAMPFIRE_FUEL_RECORDS.every((row) => row.derivation?.kind === "campfireFuel")).toBe(true);
    expect(CAMPFIRE_FUELS).toEqual(rawCampfireFuels.map(({ derivation: _derivation, ...fuel }) => fuel));
    expect(CAMPFIRE_FUELS.every((fuel) => !Object.hasOwn(fuel, "derivation"))).toBe(true);
  });

  it("derives every locked value from the explicit campfire and recipe balances", () => {
    for (const fuel of CAMPFIRE_FUELS) {
      expect(campfireFuel(campfireParameters, recipeParameters, {
        logItemId: fuel.logItemId,
        tier: fuel.tier,
        visualLogAssetId: fuel.visualLogAssetId,
      })).toEqual(fuel);
    }
  });

  it("hydrates gathering tiers with the canonical fuel object", () => {
    for (const tier of GATHERING_PRODUCTION_TIERS) {
      expect(tier.campfire).toBe(campfireFuelByLog(tier.campfire.logItemId));
      expect(CAMPFIRE_FUELS).toContain(tier.campfire);
    }
  });

  it("exports tagged records only after source parity validation", () => {
    expect(buildCampfireFuelRecords(CAMPFIRE_FUELS, campfireParameters, recipeParameters)).toEqual(CAMPFIRE_FUEL_RECORDS);
    const drifted = CAMPFIRE_FUELS.map((fuel, index): CampfireFuelDef => index === 4
      ? { ...fuel, buildXp: { ...fuel.buildXp, crafting: fuel.buildXp.crafting + 1 } }
      : fuel);
    expect(() => buildCampfireFuelRecords(drifted, campfireParameters, recipeParameters))
      .toThrow("Cannot tag drifted campfire fuel willow_log");
  });

  it("keeps identity and derivation schemas strict", () => {
    expect(() => parseCollection(CampfireFuelSchema, [rawCampfireFuels[0], rawCampfireFuels[0]], {
      name: "campfireFuels", idKey: "logItemId",
    })).toThrow('duplicate logItemId "palewood_log"');
    expect(() => parseValue(CampfireFuelDerivationSchema, { kind: "campfireFuel", extra: true }, "fuel.derivation"))
      .toThrow("extra");
    expect(() => parseValue(CampfireFuelRecordSchema, { ...rawCampfireFuels[0], derivation: { kind: "future" } }, "campfireFuels[0]"))
      .toThrow("derivation.kind");
  });
});
