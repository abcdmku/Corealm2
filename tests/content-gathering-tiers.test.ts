import { describe, expect, it } from "vitest";
import gatheringTierData from "../game/content/data/gatheringTiers.json";
import campfireFuelData from "../game/content/data/campfireFuels.json";
import {
  CAMPFIRE_FUELS, GATHERING_PRODUCTION_TIERS, gatheringProductionTier,
} from "../game/src/content/gatheringProductionTiers.js";
import { resourceById } from "../game/src/content/resourceData.js";
import { parseCollection, type Schema } from "../game/src/content/schema/core.js";
import { GatheringTierSchema, type GatheringTierRecord } from "../game/src/content/schema/gatheringTiers.js";
import type { GatheringProductionTierDef } from "../game/src/content/index.js";
import { buildGatheringTierRecords } from "../tools/content/export-gathering-tiers.js";
import { compareModuleExports } from "../tools/content/parity.js";

const runtimeSchema = GatheringTierSchema satisfies Schema<GatheringTierRecord>;

describe("gathering tier JSON content", () => {
  it("loads authored rows in order and hydrates shared resource definitions", () => {
    expect(runtimeSchema).toBe(GatheringTierSchema);
    expect(GATHERING_PRODUCTION_TIERS.map((row) => row.tier)).toEqual([1, 5, 10, 20]);
    expect(GATHERING_PRODUCTION_TIERS.map((row) => row.tier)).toEqual(gatheringTierData.map((row) => row.tier));

    for (const [index, record] of gatheringTierData.entries()) {
      const tier = GATHERING_PRODUCTION_TIERS[index]!;
      expect(record).not.toHaveProperty("campfire");
      expect(record.campfireFuelId).toBe(tier.campfire.logItemId);
      const resourceIds = record.resourceDefIds;
      expect(tier.resourceDefs.map((resource) => resource.id)).toEqual(resourceIds);
      expect(tier.resourceDefs).toEqual(resourceIds.map((resourceId) => resourceById(resourceId)));
      expect(tier.resourceDefs.every((resource, resourceIndex) => resource === resourceById(resourceIds[resourceIndex]!))).toBe(true);
      expect(tier.resources.mining).toEqual(tier.resourceDefs.filter((resource) => resource.skill === "mining").map((resource) => resource.id));
    }
  });

  it("preserves campfire order, lookup identity, and high-tier fuel fallbacks", () => {
    expect(CAMPFIRE_FUELS).toHaveLength(9);
    for (const [index, tier] of GATHERING_PRODUCTION_TIERS.entries()) {
      expect(CAMPFIRE_FUELS[index]).toBe(tier.campfire);
      expect(gatheringProductionTier(tier.tier)).toBe(tier);
    }
    expect(gatheringProductionTier(999)).toBeUndefined();
    expect(CAMPFIRE_FUELS.map((fuel) => fuel.tier)).toEqual([1, 5, 10, 20, 30, 40, 50, 60, 70]);
    expect(CAMPFIRE_FUELS).toEqual(campfireFuelData.map(({ derivation: _derivation, ...fuel }) => fuel));
  });

  it("round-trips the export shape without duplicating resource rows", () => {
    const records = buildGatheringTierRecords(GATHERING_PRODUCTION_TIERS as readonly GatheringProductionTierDef[]);
    expect(records).toEqual(gatheringTierData);
    expect(records.every((record) => !("resourceDefs" in record))).toBe(true);
    expect(parseCollection(GatheringTierSchema, records, { name: "gatheringTiers", idKey: "tier" })).toEqual(records);
  });

  it("rejects duplicate numeric tier identities and unknown fields", () => {
    const duplicate = [gatheringTierData[0], gatheringTierData[0]];
    expect(() => parseCollection(GatheringTierSchema, duplicate, { name: "gatheringTiers", idKey: "tier" }))
      .toThrow('duplicate tier "1"');
    expect(() => parseCollection(GatheringTierSchema, [{ ...gatheringTierData[0], extra: true }], {
      name: "gatheringTiers", idKey: "tier",
    })).toThrow("gatheringTiers[0:1].extra: unknown field");
  });

  it("exposes identity, foreign-key, and unit metadata", () => {
    expect(GatheringTierSchema.fields.tier.meta).toMatchObject({ readOnly: true, identity: true });
    expect(GatheringTierSchema.fields.resourceDefIds.item.meta.ref).toBe("resource");
    expect(GatheringTierSchema.fields.resources.fields.fishing.meta.ref).toBe("resource");
    expect(GatheringTierSchema.fields.items.fields.ore.meta.ref).toBe("item");
    expect(GatheringTierSchema.fields.campfireFuelId.meta).toMatchObject({ ref: "campfireFuel", readOnly: true });
  });

  it("matches every named baseline export", async () => {
    const reports = await compareModuleExports("game/src/content/gatheringProductionTiers.ts", "all");
    expect(reports.length).toBe(3);
    expect(reports.every((report) => report.ok), JSON.stringify(reports)).toBe(true);
  });
});
